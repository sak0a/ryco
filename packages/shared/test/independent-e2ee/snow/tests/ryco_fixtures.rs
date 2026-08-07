use serde_json::Value;
use snow::{params::NoiseParams, Builder, HandshakeState};
use std::{error::Error, fs, path::PathBuf};

type TestResult = Result<(), Box<dyn Error>>;

const IK_FIXTURE: &str = "f06-ik-handshake.json";
const NX_FIXTURE: &str = "f07-nx-handshake.json";
const IK_PROTOCOL: &str = "Noise_IK_25519_ChaChaPoly_SHA256";
const NX_PROTOCOL: &str = "Noise_NX_25519_ChaChaPoly_SHA256";

fn fixture_path(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../../fixtures/e2ee/v1")
        .join(name)
}

fn fixture(name: &str) -> TestResult {
    let path = fixture_path(name);
    let document: Value = serde_json::from_str(&fs::read_to_string(path)?)?;
    replay_fixture(name, &document)
}

fn fixture_hex(document: &Value, pointer: &str) -> Vec<u8> {
    let encoded = document
        .pointer(pointer)
        .and_then(Value::as_str)
        .unwrap_or_else(|| panic!("fixture field {pointer}/$bytes must be a hexadecimal string"));
    assert_eq!(
        encoded.len() % 2,
        0,
        "fixture field {pointer}/$bytes has odd length"
    );

    encoded
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            let text = std::str::from_utf8(pair).expect("fixture hex must be ASCII");
            u8::from_str_radix(text, 16).expect("fixture hex must contain only hexadecimal digits")
        })
        .collect()
}

fn fixture_text<'a>(document: &'a Value, pointer: &str) -> &'a str {
    document
        .pointer(pointer)
        .and_then(Value::as_str)
        .unwrap_or_else(|| panic!("fixture field {pointer} must be a string"))
}

fn build_states(
    pattern: &str,
    prologue: &[u8],
    initiator_ephemeral: &[u8],
    responder_ephemeral: &[u8],
    node_secret: &[u8],
    node_public: &[u8],
    client_secret: &[u8],
) -> Result<(HandshakeState, HandshakeState), snow::Error> {
    let initiator_params: NoiseParams = pattern.parse()?;
    let responder_params: NoiseParams = pattern.parse()?;

    let initiator = if pattern == IK_PROTOCOL {
        Builder::new(initiator_params)
            .prologue(prologue)
            .local_private_key(client_secret)
            .remote_public_key(node_public)
            .fixed_ephemeral_key_for_testing_only(initiator_ephemeral)
            .build_initiator()?
    } else {
        Builder::new(initiator_params)
            .prologue(prologue)
            .fixed_ephemeral_key_for_testing_only(initiator_ephemeral)
            .build_initiator()?
    };

    let responder = Builder::new(responder_params)
        .prologue(prologue)
        .local_private_key(node_secret)
        .fixed_ephemeral_key_for_testing_only(responder_ephemeral)
        .build_responder()?;

    Ok((initiator, responder))
}

fn replay_fixture(name: &str, document: &Value) -> TestResult {
    let case = document
        .pointer("/cases/0")
        .unwrap_or_else(|| panic!("{name} must contain one generated complete-trace case"));
    let pattern = fixture_text(case, "/inputs/pattern");
    let protocol = match pattern {
        "IK" => IK_PROTOCOL,
        "NX" => NX_PROTOCOL,
        other => panic!("unsupported generated Ryco pattern {other}"),
    };

    let prologue = fixture_hex(case, "/expected/prologue/$bytes");
    let initiator_ephemeral = fixture_hex(
        document,
        "/testKeyMaterial/testOnlyClientEphemeralSecretKey/$bytes",
    );
    let responder_ephemeral = fixture_hex(
        document,
        "/testKeyMaterial/testOnlyNodeEphemeralSecretKey/$bytes",
    );
    let node_secret = fixture_hex(
        document,
        "/testKeyMaterial/testOnlyNodeAgreementSecretKey/$bytes",
    );
    let node_public = fixture_hex(document, "/testKeyMaterial/nodeAgreementPublicKey/$bytes");
    let client_secret = fixture_hex(
        document,
        "/testKeyMaterial/testOnlyClientAgreementSecretKey/$bytes",
    );
    let message_1_payload = fixture_hex(case, "/expected/message1PayloadPlaintext/$bytes");
    let message_2_payload = fixture_hex(case, "/expected/message2PayloadPlaintext/$bytes");
    let expected_message_1 = fixture_hex(case, "/expected/noiseMessage1/$bytes");
    let expected_message_2 = fixture_hex(case, "/expected/noiseMessage2/$bytes");
    let expected_handshake_hash = fixture_hex(case, "/expected/noiseHandshakeHash/$bytes");
    let expected_c2n = fixture_hex(case, "/expected/epochSecretC2N/$bytes");
    let expected_n2c = fixture_hex(case, "/expected/epochSecretN2C/$bytes");

    let (mut initiator, mut responder) = build_states(
        protocol,
        &prologue,
        &initiator_ephemeral,
        &responder_ephemeral,
        &node_secret,
        &node_public,
        &client_secret,
    )?;

    let mut message = vec![0_u8; 65_535];
    let mut payload = vec![0_u8; 65_535];

    let message_1_len = initiator.write_message(&message_1_payload, &mut message)?;
    assert_eq!(
        &message[..message_1_len],
        expected_message_1,
        "{name}: Snow message 1 differs from generated Ryco wire input"
    );
    let payload_1_len = responder.read_message(&message[..message_1_len], &mut payload)?;
    assert_eq!(
        &payload[..payload_1_len],
        message_1_payload,
        "{name}: Snow responder recovered a different message-1 payload"
    );

    let message_2_len = responder.write_message(&message_2_payload, &mut message)?;
    assert_eq!(
        &message[..message_2_len],
        expected_message_2,
        "{name}: Snow message 2 differs from generated Ryco wire input"
    );
    let payload_2_len = initiator.read_message(&message[..message_2_len], &mut payload)?;
    assert_eq!(
        &payload[..payload_2_len],
        message_2_payload,
        "{name}: Snow initiator recovered a different message-2 payload"
    );

    assert!(
        initiator.is_handshake_finished(),
        "{name}: initiator did not finish"
    );
    assert!(
        responder.is_handshake_finished(),
        "{name}: responder did not finish"
    );
    assert_eq!(
        initiator.get_handshake_hash(),
        responder.get_handshake_hash(),
        "{name}: endpoints derived different final Noise handshake hashes"
    );
    assert_eq!(initiator.get_handshake_hash(), expected_handshake_hash);

    // This method exists only because this isolated test crate enables Snow's
    // `risky-raw-split` feature. These bytes must never be used by production code.
    let initiator_split = initiator.dangerously_get_raw_split();
    let responder_split = responder.dangerously_get_raw_split();
    assert_eq!(
        initiator_split, responder_split,
        "{name}: endpoints split differently"
    );
    assert_eq!(
        initiator_split.0.as_slice(),
        expected_c2n,
        "{name}: c2n split key differs"
    );
    assert_eq!(
        initiator_split.1.as_slice(),
        expected_n2c,
        "{name}: n2c split key differs"
    );

    Ok(())
}

#[test]
fn snow_replays_generated_ryco_ik_fixture() -> TestResult {
    fixture(IK_FIXTURE)
}

#[test]
fn snow_replays_generated_ryco_nx_fixture() -> TestResult {
    fixture(NX_FIXTURE)
}
