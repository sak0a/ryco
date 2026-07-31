import { describe, expect, it } from "vite-plus/test";

import {
  E2EE_CROCKFORD_ALPHABET,
  E2EE_SAFETY_NUMBER_DIGITS,
  E2EE_SAFETY_NUMBER_GROUP_BYTES,
  E2EE_SAFETY_NUMBER_GROUP_MODULUS,
  E2EE_SAFETY_NUMBER_HKDF_BYTES,
  E2EE_WEB_SAS_CHARS,
  E2EE_WEB_SAS_HKDF_BYTES,
} from "./relayE2eeConstants.ts";
import { RelayE2eeValidationError } from "./relayE2eeKeys.ts";
import {
  E2EE_SAFETY_NUMBER_DOMAIN,
  E2EE_SAFETY_ROLE_CLIENT,
  E2EE_SAFETY_ROLE_NODE,
  E2EE_SAFETY_ROLE_WEB,
  E2EE_WEB_SAS_DOMAIN,
  deriveE2eeSafetyNumber,
  deriveE2eeWebSas,
  encodeE2eeSafetyNumberInput,
  encodeE2eeWebSasInput,
  renderE2eeSafetyNumber,
  renderE2eeWebSas,
} from "./relayE2eeVerificationDisplay.ts";

const bytes = (hex: string): Uint8Array => Uint8Array.from(Buffer.from(hex, "hex"));
const hex = (value: Uint8Array): string => Buffer.from(value).toString("hex");

// Deterministic §16.1-style material. TEST ONLY.
const NODE_PUBLIC_KEY = bytes("03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8");
const CLIENT_PUBLIC_KEY = bytes(
  "047a593180860c4037c83c12749845c8ee1424dd297fadcb895e358255d2c7d2" +
    "b2a8ca25580f2626fe579062ff1b99ff91c24a0da06fb32b5be20148c9249f5650",
);
const WEB_EPHEMERAL_PUBLIC_KEY = bytes(
  "197fc2c567dc03ee2aadf0ed86681dac24daa76e83ca555875dd3be7376e5306",
);
const SESSION_BINDING_HASH = bytes("5a".repeat(32));
const OTHER_SESSION_BINDING_HASH = bytes("5b".repeat(32));

const HUB_ORIGIN = "https://hub.example.com";
const ACCOUNT_ID = "acct_0123456789";

const SAFETY_INPUT =
  "8978207279636f2e72656c61792d653265652e7361666574792d6e756d6265722e7631646e6f64656765643235353139582003a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b866636c69656e7464703235365841047a593180860c4037c83c12749845c8ee1424dd297fadcb895e358255d2c7d2b2a8ca25580f2626fe579062ff1b99ff91c24a0da06fb32b5be20148c9249f56507768747470733a2f2f6875622e6578616d706c652e636f6d6f616363745f30313233343536373839";
const SAFETY_SECRET = "4e1a80be0ac182b0989931a911967373402bd94e29a6b63829a82dc37b447780";
const SAFETY_OUTPUT =
  "814bef6b88bbef7d9213b3c2ddcc279597139874e52179f143c2fbdecf188b5ddc9f6a90e4a043f19110661fa8576cc5b1f05411a98b2987181fd838";
const SAFETY_DISPLAY = "63016 68371 61607 70932 50531 38648 93962 99025 86152 50224 76745 25112";
const OTHER_ACCOUNT_SAFETY_DISPLAY =
  "05581 40115 39204 74606 29493 17283 58460 27495 23379 88626 58509 36162";

const WEB_SAS_INPUT =
  "87781a7279636f2e72656c61792d653265652e7765622d7361732e7631646e6f64656765643235353139582003a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b863776562667832353531395820197fc2c567dc03ee2aadf0ed86681dac24daa76e83ca555875dd3be7376e5306";
const WEB_SAS_PRK = "54875b22b3bd41718c27b9975584b1bba24026220d411fc056997fc616348530";
const WEB_SAS_OUTPUT = "1d0c46fed1";
const WEB_SAS_DISPLAY = "3M64-DZPH";
const OTHER_SESSION_WEB_SAS_DISPLAY = "KBZK-BP72";

const safetyInput = {
  nodeIdentityPublicKey: NODE_PUBLIC_KEY,
  clientIdentityPublicKey: CLIENT_PUBLIC_KEY,
  hubOrigin: HUB_ORIGIN,
  accountId: ACCOUNT_ID,
} as const;

const webSasInput = {
  nodeIdentityPublicKey: NODE_PUBLIC_KEY,
  webEphemeralPublicKey: WEB_EPHEMERAL_PUBLIC_KEY,
  sessionBindingHash: SESSION_BINDING_HASH,
} as const;

describe("§13.4 native safety number", () => {
  it("pins the domain and the fixed role labels", () => {
    expect(E2EE_SAFETY_NUMBER_DOMAIN).toBe("ryco.relay-e2ee.safety-number.v1");
    expect(E2EE_SAFETY_ROLE_NODE).toBe("node");
    expect(E2EE_SAFETY_ROLE_CLIENT).toBe("client");
  });

  it("matches the deterministic input, secret, output, and display fixtures", () => {
    const derived = deriveE2eeSafetyNumber(safetyInput);
    expect(hex(derived.input)).toBe(SAFETY_INPUT);
    // 0x89 is a definite-length CBOR array of exactly 9 elements (§13.4).
    expect(derived.input[0]).toBe(0x89);
    expect(hex(derived.secret)).toBe(SAFETY_SECRET);
    expect(hex(derived.output)).toBe(SAFETY_OUTPUT);
    expect(derived.output.byteLength).toBe(E2EE_SAFETY_NUMBER_HKDF_BYTES);
    expect(derived.display).toBe(SAFETY_DISPLAY);
    expect(hex(encodeE2eeSafetyNumberInput(safetyInput))).toBe(SAFETY_INPUT);
  });

  it("renders exactly the §3.2 display format", () => {
    const derived = deriveE2eeSafetyNumber(safetyInput);
    const groups = derived.display.split(E2EE_SAFETY_NUMBER_DIGITS.separator);
    expect(groups).toHaveLength(E2EE_SAFETY_NUMBER_DIGITS.groups);
    for (const group of groups) {
      expect(group).toHaveLength(E2EE_SAFETY_NUMBER_DIGITS.digitsPerGroup);
      expect(group).toMatch(/^[0-9]{5}$/);
      expect(Number(group)).toBeLessThan(E2EE_SAFETY_NUMBER_GROUP_MODULUS);
    }
    expect(derived.display.replace(/ /g, "")).toHaveLength(E2EE_SAFETY_NUMBER_DIGITS.digits);
  });

  it("reads the groups in derivation order, big-endian and zero-padded", () => {
    // The first group is the first `E2EE_SAFETY_NUMBER_GROUP_BYTES` of `out`,
    // big-endian, modulo the group modulus: 0x814bef6b88 mod 100000 = 63016.
    expect(
      BigInt(`0x${SAFETY_OUTPUT.slice(0, E2EE_SAFETY_NUMBER_GROUP_BYTES * 2)}`) % 100_000n,
    ).toBe(63_016n);
    expect(SAFETY_DISPLAY.slice(0, 5)).toBe("63016");
    // A leading-zero group is padded, not truncated.
    expect(OTHER_ACCOUNT_SAFETY_DISPLAY.slice(0, 5)).toBe("05581");
  });

  it("binds the Hub/account namespace and both identity keys", () => {
    expect(deriveE2eeSafetyNumber({ ...safetyInput, accountId: "acct_9876543210" }).display).toBe(
      OTHER_ACCOUNT_SAFETY_DISPLAY,
    );
    expect(
      deriveE2eeSafetyNumber({ ...safetyInput, accountId: "acct_9876543210" }).display,
    ).not.toBe(SAFETY_DISPLAY);
    expect(
      deriveE2eeSafetyNumber({ ...safetyInput, hubOrigin: "https://other.example.com" }).display,
    ).not.toBe(SAFETY_DISPLAY);
  });

  it("rejects key material it will not fingerprint", () => {
    expect(() =>
      deriveE2eeSafetyNumber({ ...safetyInput, nodeIdentityPublicKey: new Uint8Array(31) }),
    ).toThrow(RelayE2eeValidationError);
    expect(() =>
      deriveE2eeSafetyNumber({ ...safetyInput, clientIdentityPublicKey: NODE_PUBLIC_KEY }),
    ).toThrow(RelayE2eeValidationError);
    expect(() => deriveE2eeSafetyNumber({ ...safetyInput, accountId: "" })).toThrow(
      RelayE2eeValidationError,
    );
    expect(() => renderE2eeSafetyNumber(new Uint8Array(59))).toThrow(RelayE2eeValidationError);
  });
});

describe("§13.5 WebSAS", () => {
  it("pins the domain and the fixed role labels", () => {
    expect(E2EE_WEB_SAS_DOMAIN).toBe("ryco.relay-e2ee.web-sas.v1");
    expect(E2EE_SAFETY_ROLE_WEB).toBe("web");
    expect(E2EE_CROCKFORD_ALPHABET).toBe("0123456789ABCDEFGHJKMNPQRSTVWXYZ");
  });

  it("matches the deterministic input, prk, output, and display fixtures", () => {
    const derived = deriveE2eeWebSas(webSasInput);
    expect(hex(derived.input)).toBe(WEB_SAS_INPUT);
    // 0x87 is a definite-length CBOR array of exactly 7 elements (§13.5).
    expect(derived.input[0]).toBe(0x87);
    expect(hex(derived.prk)).toBe(WEB_SAS_PRK);
    expect(hex(derived.output)).toBe(WEB_SAS_OUTPUT);
    expect(derived.output.byteLength).toBe(E2EE_WEB_SAS_HKDF_BYTES);
    expect(derived.display).toBe(WEB_SAS_DISPLAY);
    expect(hex(encodeE2eeWebSasInput(webSasInput))).toBe(WEB_SAS_INPUT);
  });

  it("renders five-bit groups most significant bit first", () => {
    // 0x1d0c46fed1 = 00011 10100 00110 00100 01101 11111 10110 10001 →
    // 3, 20, 6, 4, 13, 31, 22, 17 → "3", "M", "6", "4", "D", "Z", "P", "H".
    expect(renderE2eeWebSas(bytes(WEB_SAS_OUTPUT))).toBe(WEB_SAS_DISPLAY);
    expect(
      [3, 20, 6, 4, 13, 31, 22, 17].map((index) => E2EE_CROCKFORD_ALPHABET[index]).join(""),
    ).toBe("3M64DZPH");
    const groups = WEB_SAS_DISPLAY.split(E2EE_WEB_SAS_CHARS.separator);
    expect(groups).toHaveLength(E2EE_WEB_SAS_CHARS.groups);
    for (const group of groups) expect(group).toHaveLength(E2EE_WEB_SAS_CHARS.charsPerGroup);
    expect(WEB_SAS_DISPLAY.replace(/-/g, "")).toHaveLength(E2EE_WEB_SAS_CHARS.chars);
    // An all-zero output renders as the alphabet's first character throughout.
    expect(renderE2eeWebSas(new Uint8Array(E2EE_WEB_SAS_HKDF_BYTES))).toBe("0000-0000");
  });

  it("is session bound: the same keys under a different session hash differ", () => {
    const other = deriveE2eeWebSas({
      ...webSasInput,
      sessionBindingHash: OTHER_SESSION_BINDING_HASH,
    });
    expect(other.display).toBe(OTHER_SESSION_WEB_SAS_DISPLAY);
    expect(other.display).not.toBe(WEB_SAS_DISPLAY);
    expect(hex(other.input)).toBe(WEB_SAS_INPUT);
  });

  it("rejects a short session-binding hash and a malformed ephemeral", () => {
    expect(() =>
      deriveE2eeWebSas({ ...webSasInput, sessionBindingHash: new Uint8Array(31) }),
    ).toThrow(RelayE2eeValidationError);
    expect(() =>
      deriveE2eeWebSas({ ...webSasInput, webEphemeralPublicKey: new Uint8Array(31) }),
    ).toThrow(RelayE2eeValidationError);
    expect(() => renderE2eeWebSas(new Uint8Array(4))).toThrow(RelayE2eeValidationError);
  });
});

describe("§13.4/§13.5 domain separation", () => {
  it("gives the two input arrays different bytes for the same node key", () => {
    const safety = hex(encodeE2eeSafetyNumberInput(safetyInput));
    const sas = hex(encodeE2eeWebSasInput(webSasInput));
    expect(safety).not.toBe(sas);
    // Different array headers and different domains: neither prefixes the other.
    expect(safety.slice(0, 6)).not.toBe(sas.slice(0, 6));
  });

  it("keeps the two derivations from sharing an HKDF input", () => {
    // The safety number has no extract step and no salt; the WebSAS extracts
    // with the session hash as salt. The two outputs share no bytes at any
    // aligned prefix, which is what the distinct labels and structures buy.
    const safety = deriveE2eeSafetyNumber(safetyInput);
    const sas = deriveE2eeWebSas(webSasInput);
    expect(hex(safety.output).slice(0, E2EE_WEB_SAS_HKDF_BYTES * 2)).not.toBe(hex(sas.output));
    expect(hex(safety.secret)).not.toBe(hex(sas.prk));
  });
});
