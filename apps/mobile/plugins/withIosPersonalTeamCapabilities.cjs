const { withEntitlementsPlist } = require("expo/config-plugins");

const stripUnsupportedPersonalTeamEntitlements = (entitlements) => {
  const next = { ...entitlements };

  // expo-notifications is autolinked and adds APNs during iOS prebuild. Free
  // Apple Personal Teams cannot provision APNs; local notifications do not
  // require this entitlement.
  delete next["aps-environment"];

  return next;
};

const withIosPersonalTeamCapabilities = (config) =>
  withEntitlementsPlist(config, (modConfig) => {
    modConfig.modResults = stripUnsupportedPersonalTeamEntitlements(modConfig.modResults);
    return modConfig;
  });

module.exports = withIosPersonalTeamCapabilities;
module.exports.stripUnsupportedPersonalTeamEntitlements =
  stripUnsupportedPersonalTeamEntitlements;
