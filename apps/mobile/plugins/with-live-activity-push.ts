import { withEntitlementsPlist, type ConfigPlugin } from 'expo/config-plugins'
// expo-widgets adds the APNs entitlement even when token generation is disabled.
// Local-only builds should not request a push provisioning capability.
const withLiveActivityPush: ConfigPlugin<{ enabled: boolean }> = (config, { enabled }) =>
  withEntitlementsPlist(config, (mod) => {
    if (!enabled) delete mod.modResults['aps-environment']
    return mod
  })

export default withLiveActivityPush
