const fs = require("node:fs");
const { createRequire } = require("node:module");
const path = require("node:path");

const {
  IOSConfig,
  withEntitlementsPlist,
  withFinalizedMod,
} = require("expo/config-plugins");
const expoRequire = createRequire(require.resolve("expo/config-plugins"));
const plist = expoRequire("@expo/plist").default;

const stripUnsupportedPersonalTeamEntitlements = (entitlements) => {
  const next = { ...entitlements };

  // expo-notifications is autolinked and adds APNs during iOS prebuild. Free
  // Apple Personal Teams cannot provision APNs; local notifications do not
  // require this entitlement.
  delete next["aps-environment"];

  return next;
};

const stripUnsupportedPersonalTeamEntitlementsFile = (entitlementsPath) => {
  const entitlements = plist.parse(fs.readFileSync(entitlementsPath, "utf8"));
  const next = stripUnsupportedPersonalTeamEntitlements(entitlements);

  fs.writeFileSync(entitlementsPath, plist.build(next), "utf8");
  return next;
};

const withIosPersonalTeamCapabilities = (config) => {
  const projectName = IOSConfig.XcodeUtils.sanitizedName(config.name);

  config = withEntitlementsPlist(config, (modConfig) => {
    modConfig.modResults = stripUnsupportedPersonalTeamEntitlements(modConfig.modResults);
    return modConfig;
  });

  // expo-notifications can materialize APNs after the entitlements mod has
  // already run. Enforce the Personal-Team invariant once more after every
  // iOS mod has finished so the generated project is actually signable.
  return withFinalizedMod(config, [
    "ios",
    (modConfig) => {
      // The finalized mod runs before Expo persists the generated pbxproj, so
      // derive the conventional application entitlements path from the same
      // sanitized project name rather than reparsing an xcodeproj that is not
      // on disk yet.
      const entitlementsPath = path.join(
        modConfig.modRequest.platformProjectRoot,
        projectName,
        `${projectName}.entitlements`,
      );

      if (fs.existsSync(entitlementsPath)) {
        stripUnsupportedPersonalTeamEntitlementsFile(entitlementsPath);
      }

      return modConfig;
    },
  ]);
};

module.exports = withIosPersonalTeamCapabilities;
module.exports.stripUnsupportedPersonalTeamEntitlements = stripUnsupportedPersonalTeamEntitlements;
module.exports.stripUnsupportedPersonalTeamEntitlementsFile =
  stripUnsupportedPersonalTeamEntitlementsFile;
