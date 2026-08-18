import { createHash, randomBytes } from "node:crypto";

import { AgentControlExternalSecretHash } from "../persistence/Services/AgentControlExternal.ts";

export const AGENT_CONTROL_EXTERNAL_CREDENTIAL_PREFIX = "rycoext_";
const PAIRING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export const hashAgentControlExternalSecret = (value: string): AgentControlExternalSecretHash =>
  AgentControlExternalSecretHash.make(createHash("sha256").update(value, "utf8").digest("hex"));

export const generateAgentControlExternalCredential = (): string =>
  `${AGENT_CONTROL_EXTERNAL_CREDENTIAL_PREFIX}${randomBytes(32).toString("base64url")}`;

export const generateAgentControlPairingCode = (): string => {
  const bytes = randomBytes(10);
  return Array.from(bytes, (byte) => PAIRING_ALPHABET[byte % PAIRING_ALPHABET.length]!).join("");
};

export const pairingCodeHash = (integrationId: string, pairingCode: string) =>
  hashAgentControlExternalSecret(`pair:${integrationId}:${pairingCode.trim().toUpperCase()}`);

export const parseExternalAuthorization = (header: string | undefined): string | null => {
  if (!header?.startsWith("Bearer ")) return null;
  const value = header.slice("Bearer ".length);
  return value.startsWith(AGENT_CONTROL_EXTERNAL_CREDENTIAL_PREFIX) && value.length === 51
    ? value
    : null;
};
