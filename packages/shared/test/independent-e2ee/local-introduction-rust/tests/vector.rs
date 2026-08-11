use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use ed25519_dalek::{Signature as Ed25519Signature, VerifyingKey as Ed25519VerifyingKey};
use p256::ecdsa::{
    signature::Verifier, Signature as P256Signature, VerifyingKey as P256VerifyingKey,
};
use serde_json::Value as Json;
use sha2::{Digest, Sha256};
use std::{convert::TryInto, error::Error, fs, path::PathBuf};

type TestResult = Result<(), Box<dyn Error>>;

#[derive(Clone, Debug, Eq, PartialEq)]
enum Cbor {
    Unsigned(u64),
    Bytes(Vec<u8>),
    Text(String),
    Array(Vec<Cbor>),
    Null,
}

fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../fixtures/e2ee/local-introduction/v1")
        .join(name)
}

fn read_length(input: &[u8], offset: &mut usize, additional: u8) -> Result<u64, String> {
    let width = match additional {
        0..=23 => return Ok(additional as u64),
        24 => 1,
        25 => 2,
        26 => 4,
        27 => 8,
        _ => return Err("indefinite or reserved CBOR length".into()),
    };
    if input.len().saturating_sub(*offset) < width {
        return Err("truncated CBOR length".into());
    }
    let mut value = 0_u64;
    for byte in &input[*offset..*offset + width] {
        value = (value << 8) | (*byte as u64);
    }
    *offset += width;
    Ok(value)
}

fn decode_one(input: &[u8], offset: &mut usize) -> Result<Cbor, String> {
    let initial = *input.get(*offset).ok_or("truncated CBOR value")?;
    *offset += 1;
    let major = initial >> 5;
    let additional = initial & 0x1f;
    match major {
        0 => Ok(Cbor::Unsigned(read_length(input, offset, additional)?)),
        2 | 3 => {
            let length: usize = read_length(input, offset, additional)?
                .try_into()
                .map_err(|_| "CBOR length does not fit usize")?;
            let end = offset.checked_add(length).ok_or("CBOR length overflow")?;
            let bytes = input.get(*offset..end).ok_or("truncated CBOR string")?;
            *offset = end;
            if major == 2 {
                Ok(Cbor::Bytes(bytes.to_vec()))
            } else {
                Ok(Cbor::Text(
                    std::str::from_utf8(bytes)
                        .map_err(|_| "invalid CBOR UTF-8")?
                        .to_owned(),
                ))
            }
        }
        4 => {
            let length: usize = read_length(input, offset, additional)?
                .try_into()
                .map_err(|_| "CBOR array length does not fit usize")?;
            let mut values = Vec::with_capacity(length);
            for _ in 0..length {
                values.push(decode_one(input, offset)?);
            }
            Ok(Cbor::Array(values))
        }
        7 if additional == 22 => Ok(Cbor::Null),
        _ => Err("unsupported CBOR type in LTI transcript".into()),
    }
}

fn decode(input: &[u8]) -> Result<Cbor, String> {
    let mut offset = 0;
    let value = decode_one(input, &mut offset)?;
    if offset != input.len() {
        return Err("trailing CBOR bytes".into());
    }
    Ok(value)
}

fn encode_length(major: u8, value: u64, output: &mut Vec<u8>) {
    if value < 24 {
        output.push((major << 5) | value as u8);
    } else if value <= u8::MAX as u64 {
        output.extend_from_slice(&[(major << 5) | 24, value as u8]);
    } else if value <= u16::MAX as u64 {
        output.push((major << 5) | 25);
        output.extend_from_slice(&(value as u16).to_be_bytes());
    } else if value <= u32::MAX as u64 {
        output.push((major << 5) | 26);
        output.extend_from_slice(&(value as u32).to_be_bytes());
    } else {
        output.push((major << 5) | 27);
        output.extend_from_slice(&value.to_be_bytes());
    }
}

fn encode_into(value: &Cbor, output: &mut Vec<u8>) {
    match value {
        Cbor::Unsigned(value) => encode_length(0, *value, output),
        Cbor::Bytes(bytes) => {
            encode_length(2, bytes.len() as u64, output);
            output.extend_from_slice(bytes);
        }
        Cbor::Text(text) => {
            encode_length(3, text.len() as u64, output);
            output.extend_from_slice(text.as_bytes());
        }
        Cbor::Array(values) => {
            encode_length(4, values.len() as u64, output);
            for value in values {
                encode_into(value, output);
            }
        }
        Cbor::Null => output.push(0xf6),
    }
}

fn encode(value: &Cbor) -> Vec<u8> {
    let mut output = Vec::new();
    encode_into(value, &mut output);
    output
}

fn array(value: &Cbor) -> &[Cbor] {
    match value {
        Cbor::Array(value) => value,
        _ => panic!("expected CBOR array"),
    }
}

fn bytes(value: &Cbor) -> &[u8] {
    match value {
        Cbor::Bytes(value) => value,
        _ => panic!("expected CBOR bytes"),
    }
}

fn text(value: &Cbor) -> &str {
    match value {
        Cbor::Text(value) => value,
        _ => panic!("expected CBOR text"),
    }
}

fn unsigned(value: &Cbor) -> u64 {
    match value {
        Cbor::Unsigned(value) => *value,
        _ => panic!("expected CBOR unsigned integer"),
    }
}

fn json_text<'a>(document: &'a Json, pointer: &str) -> &'a str {
    document
        .pointer(pointer)
        .and_then(Json::as_str)
        .unwrap_or_else(|| panic!("fixture field {pointer} must be text"))
}

fn json_u64(document: &Json, pointer: &str) -> u64 {
    document
        .pointer(pointer)
        .and_then(Json::as_u64)
        .unwrap_or_else(|| panic!("fixture field {pointer} must be an unsigned integer"))
}

fn b64(document: &Json, pointer: &str) -> Vec<u8> {
    URL_SAFE_NO_PAD
        .decode(json_text(document, pointer))
        .unwrap_or_else(|_| panic!("fixture field {pointer} must be unpadded base64url"))
}

fn sha256(value: &[u8]) -> Vec<u8> {
    Sha256::digest(value).to_vec()
}

fn fingerprint(domain: &str, algorithm: &str, public_key: &[u8]) -> Vec<u8> {
    sha256(&encode(&Cbor::Array(vec![
        Cbor::Text(domain.into()),
        Cbor::Text(algorithm.into()),
        Cbor::Bytes(public_key.to_vec()),
    ])))
}

#[test]
fn independently_verifies_local_introduction_vector() -> TestResult {
    let raw = fs::read(fixture_path("valid.json"))?;
    let document: Json = serde_json::from_slice(&raw)?;
    let manifest: Json = serde_json::from_slice(&fs::read(fixture_path("manifest.json"))?)?;
    assert_eq!(
        hex(&sha256(&raw)),
        json_text(&manifest, "/files/0/sha256"),
        "fixture checksum differs from its manifest"
    );

    let request_tbs = b64(&document, "/requestTbs");
    let request_value = decode(&request_tbs)?;
    assert_eq!(
        encode(&request_value),
        request_tbs,
        "request CBOR is not canonical"
    );
    let request = array(&request_value);
    assert_eq!(request.len(), 24);
    assert_eq!(text(&request[0]), "ryco.e2ee.local-introduction.request.v1");
    assert_eq!(unsigned(&request[1]), 1);
    for (index, pointer) in [
        (2, "/request/hubOrigin"),
        (3, "/request/accountId"),
        (4, "/request/claimId"),
        (5, "/request/installationId"),
        (6, "/request/environmentId"),
        (7, "/request/nodeId"),
        (16, "/request/maxRole"),
        (19, "/request/nodeContinuityId"),
        (21, "/request/claimDisposition"),
    ] {
        assert_eq!(text(&request[index]), json_text(&document, pointer));
    }
    assert_eq!(text(&request[8]), "ed25519");
    assert_eq!(bytes(&request[9]), b64(&document, "/nodePublicKey"));
    assert_eq!(text(&request[10]), "p256");
    assert_eq!(bytes(&request[11]), b64(&document, "/clientPublicKey"));
    assert_eq!(text(&request[12]), "x25519");
    assert_eq!(bytes(&request[13]), b64(&document, "/agreementPublicKey"));
    assert_eq!(
        bytes(&request[14]),
        b64(&document, "/request/introductionId")
    );
    assert_eq!(bytes(&request[15]), b64(&document, "/request/nonce"));
    assert_eq!(array(&request[17]), &[Cbor::Text("ryco.rpc".into())]);
    assert_eq!(
        text(&request[18]),
        json_text(&document, "/request/displayLabel")
    );
    assert_eq!(
        unsigned(&request[20]),
        json_u64(&document, "/request/nodePolicyGeneration")
    );
    assert_eq!(
        unsigned(&request[22]),
        json_u64(&document, "/request/issuedAt")
    );
    assert_eq!(
        unsigned(&request[23]),
        json_u64(&document, "/request/expiresAt")
    );

    let digest = sha256(&encode(&Cbor::Array(vec![
        Cbor::Text("ryco.e2ee.local-introduction.digest.v1".into()),
        Cbor::Bytes(request_tbs.clone()),
    ])));
    assert_eq!(digest, b64(&document, "/requestDigest"));

    let client_public = b64(&document, "/clientPublicKey");
    let p256_key = P256VerifyingKey::from_sec1_bytes(&client_public)?;
    let p256_signature = P256Signature::from_slice(&b64(&document, "/requestSignature"))?;
    p256_key.verify(&request_tbs, &p256_signature)?;

    let approval_tbs = b64(&document, "/approvalTbs");
    let approval_value = decode(&approval_tbs)?;
    assert_eq!(
        encode(&approval_value),
        approval_tbs,
        "approval CBOR is not canonical"
    );
    let approval = array(&approval_value);
    assert_eq!(approval.len(), 14);
    assert_eq!(
        text(&approval[0]),
        "ryco.e2ee.local-introduction.approval.v1"
    );
    assert_eq!(unsigned(&approval[1]), 1);
    assert_eq!(bytes(&approval[2]), digest);
    assert_eq!(text(&approval[3]), "approved");
    let node_public = b64(&document, "/nodePublicKey");
    let agreement_public = b64(&document, "/agreementPublicKey");
    assert_eq!(bytes(&approval[4]), node_public);
    assert_eq!(
        bytes(&approval[5]),
        fingerprint("ryco.node-key.v1", "ed25519", &node_public)
    );
    assert_eq!(
        bytes(&approval[6]),
        fingerprint("ryco.client-key.v1", "p256", &client_public)
    );
    assert_eq!(
        bytes(&approval[7]),
        fingerprint("ryco.e2ee-agreement-key.v1", "x25519", &agreement_public)
    );
    assert_eq!(text(&approval[8]), "owner");
    assert_eq!(array(&approval[9]), &[Cbor::Text("ryco.rpc".into())]);
    assert_eq!(
        text(&approval[10]),
        json_text(&document, "/request/nodeContinuityId")
    );
    assert_eq!(
        unsigned(&approval[11]),
        json_u64(&document, "/request/nodePolicyGeneration")
    );
    assert_eq!(unsigned(&approval[12]), json_u64(&document, "/approvedAt"));
    assert_eq!(
        unsigned(&approval[13]),
        json_u64(&document, "/request/expiresAt")
    );

    let node_key_bytes: [u8; 32] = node_public.as_slice().try_into()?;
    let node_key = Ed25519VerifyingKey::from_bytes(&node_key_bytes)?;
    let approval_signature = Ed25519Signature::from_slice(&b64(&document, "/approvalSignature"))?;
    node_key.verify_strict(&approval_tbs, &approval_signature)?;
    Ok(())
}

fn hex(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 16] = b"0123456789abcdef";
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        output.push(ALPHABET[(byte >> 4) as usize] as char);
        output.push(ALPHABET[(byte & 0x0f) as usize] as char);
    }
    output
}
