const { withEntitlementsPlist } = require('expo/config-plugins')
// expo-widgets adds the APNs entitlement even when token generation is disabled.
// Local-only builds should not request a push provisioning capability.
module.exports = (config, { enabled }) =>
  withEntitlementsPlist(config, (mod) => {
    if (!enabled) delete mod.modResults['aps-environment']
    return mod
  })
