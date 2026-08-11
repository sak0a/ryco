import CryptoKit
import Foundation

private let maximumRequestBytes = 64 * 1024
private let maximumSigningPayloadBytes = 64 * 1024
private let maximumWrappedKeyBytes = 2 * 1024
private let agreementRecordVersion: UInt8 = 1
private let agreementSharedInfo = Data("ryco.desktop.x25519-wrap.v1".utf8)

private enum HelperError: Error {
  case invalidRequest
  case unavailable
  case operationFailed
}

private struct SuccessResponse {
  let fields: [String: Any]
}

private func readBoundedRequest() throws -> Data {
  var result = Data()
  while true {
    guard let chunk = try FileHandle.standardInput.read(upToCount: 4_096) else { break }
    if chunk.isEmpty { break }
    result.append(chunk)
    if result.count > maximumRequestBytes { throw HelperError.invalidRequest }
  }
  guard !result.isEmpty else { throw HelperError.invalidRequest }
  return result
}

private func parseRequest(_ data: Data) throws -> [String: Any] {
  guard
    let value = try? JSONSerialization.jsonObject(with: data),
    let request = value as? [String: Any]
  else {
    throw HelperError.invalidRequest
  }
  return request
}

private func exactKeys(_ request: [String: Any], _ expected: Set<String>) throws {
  guard Set(request.keys) == expected else { throw HelperError.invalidRequest }
}

private func string(_ request: [String: Any], _ key: String) throws -> String {
  guard let value = request[key] as? String else { throw HelperError.invalidRequest }
  return value
}

private func decodedData(
  _ request: [String: Any],
  _ key: String,
  maximumBytes: Int
) throws -> Data {
  let encoded = try string(request, key)
  guard
    !encoded.isEmpty,
    let data = Data(base64Encoded: encoded),
    data.count <= maximumBytes,
    data.base64EncodedString() == encoded
  else {
    throw HelperError.invalidRequest
  }
  return data
}

private func ensureSecureEnclave() throws {
  guard SecureEnclave.isAvailable else { throw HelperError.unavailable }
}

private func createSigningKey() throws -> SuccessResponse {
  try ensureSecureEnclave()
  do {
    let key = try SecureEnclave.P256.Signing.PrivateKey()
    let publicKey = key.publicKey.x963Representation
    guard publicKey.count == 65, publicKey.first == 0x04 else {
      throw HelperError.operationFailed
    }
    return SuccessResponse(fields: [
      "backing": "secure-enclave",
      "keyRecord": key.dataRepresentation.base64EncodedString(),
      "publicKey": publicKey.base64EncodedString(),
    ])
  } catch let error as HelperError {
    throw error
  } catch {
    throw HelperError.unavailable
  }
}

private func loadSigningKey(_ request: [String: Any]) throws -> SecureEnclave.P256.Signing.PrivateKey {
  try ensureSecureEnclave()
  let record = try decodedData(request, "keyRecord", maximumBytes: maximumWrappedKeyBytes)
  do {
    return try SecureEnclave.P256.Signing.PrivateKey(dataRepresentation: record)
  } catch {
    throw HelperError.operationFailed
  }
}

private func inspectSigningKey(_ request: [String: Any]) throws -> SuccessResponse {
  let key = try loadSigningKey(request)
  let publicKey = key.publicKey.x963Representation
  guard publicKey.count == 65, publicKey.first == 0x04 else {
    throw HelperError.operationFailed
  }
  return SuccessResponse(fields: [
    "backing": "secure-enclave",
    "publicKey": publicKey.base64EncodedString(),
  ])
}

private func sign(_ request: [String: Any]) throws -> SuccessResponse {
  let key = try loadSigningKey(request)
  let payload = try decodedData(request, "payload", maximumBytes: maximumSigningPayloadBytes)
  do {
    return SuccessResponse(fields: [
      "signature": try key.signature(for: payload).derRepresentation.base64EncodedString()
    ])
  } catch {
    throw HelperError.operationFailed
  }
}

private func agreementWrappingKey(
  _ dataRepresentation: Data
) throws -> SecureEnclave.P256.KeyAgreement.PrivateKey {
  try ensureSecureEnclave()
  do {
    return try SecureEnclave.P256.KeyAgreement.PrivateKey(dataRepresentation: dataRepresentation)
  } catch {
    throw HelperError.operationFailed
  }
}

private func agreementSymmetricKey(
  _ wrappingKey: SecureEnclave.P256.KeyAgreement.PrivateKey
) throws -> SymmetricKey {
  do {
    let shared = try wrappingKey.sharedSecretFromKeyAgreement(with: wrappingKey.publicKey)
    return shared.hkdfDerivedSymmetricKey(
      using: SHA256.self,
      salt: Data(),
      sharedInfo: agreementSharedInfo,
      outputByteCount: 32
    )
  } catch {
    throw HelperError.operationFailed
  }
}

private func encodeAgreementRecord(wrappingKey: Data, sealedKey: Data) throws -> Data {
  guard
    !wrappingKey.isEmpty,
    wrappingKey.count <= maximumWrappedKeyBytes,
    sealedKey.count == 60,
    wrappingKey.count <= Int(UInt16.max)
  else {
    throw HelperError.operationFailed
  }
  var record = Data([agreementRecordVersion])
  let length = UInt16(wrappingKey.count)
  record.append(UInt8(length >> 8))
  record.append(UInt8(length & 0xff))
  record.append(wrappingKey)
  record.append(sealedKey)
  return record
}

private func decodeAgreementRecord(_ request: [String: Any]) throws -> (Data, Data) {
  let record = try decodedData(
    request,
    "keyRecord",
    maximumBytes: 3 + maximumWrappedKeyBytes + 60
  )
  guard record.count >= 3 + 1 + 60, record[0] == agreementRecordVersion else {
    throw HelperError.operationFailed
  }
  let wrappedLength = (Int(record[1]) << 8) | Int(record[2])
  guard
    wrappedLength > 0,
    wrappedLength <= maximumWrappedKeyBytes,
    record.count == 3 + wrappedLength + 60
  else {
    throw HelperError.operationFailed
  }
  return (
    record.subdata(in: 3..<(3 + wrappedLength)),
    record.subdata(in: (3 + wrappedLength)..<record.count)
  )
}

private func openAgreementKey(
  _ request: [String: Any]
) throws -> Curve25519.KeyAgreement.PrivateKey {
  let (wrappedKey, sealedKey) = try decodeAgreementRecord(request)
  let wrappingKey = try agreementWrappingKey(wrappedKey)
  do {
    let box = try AES.GCM.SealedBox(combined: sealedKey)
    var raw = try AES.GCM.open(box, using: agreementSymmetricKey(wrappingKey))
    defer { raw.resetBytes(in: 0..<raw.count) }
    guard raw.count == 32 else { throw HelperError.operationFailed }
    return try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: raw)
  } catch let error as HelperError {
    throw error
  } catch {
    throw HelperError.operationFailed
  }
}

private func createAgreementKey() throws -> SuccessResponse {
  try ensureSecureEnclave()
  do {
    let wrappingKey = try SecureEnclave.P256.KeyAgreement.PrivateKey()
    let agreementKey = Curve25519.KeyAgreement.PrivateKey()
    var raw = agreementKey.rawRepresentation
    defer { raw.resetBytes(in: 0..<raw.count) }
    let sealed = try AES.GCM.seal(raw, using: agreementSymmetricKey(wrappingKey))
    guard let combined = sealed.combined else { throw HelperError.operationFailed }
    let record = try encodeAgreementRecord(
      wrappingKey: wrappingKey.dataRepresentation,
      sealedKey: combined
    )
    return SuccessResponse(fields: [
      "keyRecord": record.base64EncodedString(),
      "publicKey": agreementKey.publicKey.rawRepresentation.base64EncodedString(),
    ])
  } catch let error as HelperError {
    throw error
  } catch {
    throw HelperError.unavailable
  }
}

private func inspectAgreementKey(_ request: [String: Any]) throws -> SuccessResponse {
  let key = try openAgreementKey(request)
  return SuccessResponse(fields: [
    "publicKey": key.publicKey.rawRepresentation.base64EncodedString()
  ])
}

private func borrowAgreementKey(_ request: [String: Any]) throws -> SuccessResponse {
  let key = try openAgreementKey(request)
  var raw = key.rawRepresentation
  defer { raw.resetBytes(in: 0..<raw.count) }
  return SuccessResponse(fields: ["secretKey": raw.base64EncodedString()])
}

private func perform(_ request: [String: Any]) throws -> SuccessResponse {
  let operation = try string(request, "operation")
  switch operation {
  case "signing.create":
    try exactKeys(request, ["operation"])
    return try createSigningKey()
  case "signing.inspect":
    try exactKeys(request, ["operation", "keyRecord"])
    return try inspectSigningKey(request)
  case "signing.sign":
    try exactKeys(request, ["operation", "keyRecord", "payload"])
    return try sign(request)
  case "agreement.create":
    try exactKeys(request, ["operation"])
    return try createAgreementKey()
  case "agreement.inspect":
    try exactKeys(request, ["operation", "keyRecord"])
    return try inspectAgreementKey(request)
  case "agreement.borrow":
    try exactKeys(request, ["operation", "keyRecord"])
    return try borrowAgreementKey(request)
  default:
    throw HelperError.invalidRequest
  }
}

private func publicErrorCode(_ error: Error) -> String {
  guard let helper = error as? HelperError else { return "operation_failed" }
  switch helper {
  case .invalidRequest:
    return "invalid_request"
  case .unavailable:
    return "unavailable"
  case .operationFailed:
    return "operation_failed"
  }
}

private func writeResponse(_ body: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: body, options: [.sortedKeys]) else {
    exit(1)
  }
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data([0x0a]))
}

do {
  let response = try perform(parseRequest(readBoundedRequest()))
  writeResponse(["ok": true].merging(response.fields) { current, _ in current })
} catch {
  writeResponse(["ok": false, "error": publicErrorCode(error)])
}
