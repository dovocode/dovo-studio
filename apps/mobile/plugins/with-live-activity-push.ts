import { withEntitlementsPlist, type ConfigPlugin } from 'expo/config-plugins'
// Widgets and ordinary push notifications share the app’s APNs entitlement.
// Local-only builds should not request a push provisioning capability.
const withLiveActivityPush: ConfigPlugin<{ enabled: boolean }> = (config, { enabled }) =>
  withEntitlementsPlist(config, (mod) => {
    if (!enabled) delete mod.modResults['aps-environment']
    else
      mod.modResults['aps-environment'] =
        process.env.DOVO_APNS_ENVIRONMENT === 'production' ? 'production' : 'development'
    return mod
  })

export default withLiveActivityPush
