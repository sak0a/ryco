import { createHash } from "node:crypto";

import { HUB_NODE_NAME_MAX_LENGTH, normalizeHubNodeName } from "@ryco/shared/nodeIdentity";

const AUTOMATIC_LABEL_DOMAIN = "ryco.hub-node-label.v1\0";
const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const TAG_LENGTH = 4;
const SEPARATOR = " · ";
const FALLBACK_MACHINE_LABEL = "Ryco environment";

function automaticTag(environmentId: string): string {
  const digest = createHash("sha256")
    .update(`${AUTOMATIC_LABEL_DOMAIN}${environmentId}`, "utf8")
    .digest();
  const firstTwentyBits = (digest[0]! << 12) | (digest[1]! << 4) | (digest[2]! >> 4);
  return [15, 10, 5, 0].map((shift) => CROCKFORD_BASE32[(firstTwentyBits >> shift) & 31]).join("");
}

function truncateWithoutSplittingScalars(value: string, maximumCodeUnits: number): string {
  let result = "";
  for (const scalar of value) {
    if (result.length + scalar.length > maximumCodeUnits) break;
    result += scalar;
  }
  return result.trimEnd();
}

export function resolveHubEnrollmentLabel(input: {
  readonly configuredNodeName: string | undefined;
  readonly machineLabel: string;
  readonly environmentId: string;
}): string {
  if (input.configuredNodeName !== undefined) {
    return normalizeHubNodeName(input.configuredNodeName);
  }

  const tag = automaticTag(input.environmentId);
  const maximumMachineLength = HUB_NODE_NAME_MAX_LENGTH - SEPARATOR.length - TAG_LENGTH;
  const machineLabel = input.machineLabel.trim() || FALLBACK_MACHINE_LABEL;
  const truncatedMachineLabel =
    truncateWithoutSplittingScalars(machineLabel, maximumMachineLength) || FALLBACK_MACHINE_LABEL;
  return `${truncatedMachineLabel}${SEPARATOR}${tag}`;
}
