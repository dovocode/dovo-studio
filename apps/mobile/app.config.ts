import type { ConfigContext, ExpoConfig } from 'expo/config'
export default ({ config }: ConfigContext): ExpoConfig => {
  const push =
    process.env.DOVO_LIVE_ACTIVITY_PUSH !== '0' && process.env.DOVO_PUSH_NOTIFICATIONS !== '0'
  const notifications = process.env.DOVO_PUSH_NOTIFICATIONS !== '0'
  return {
    ...config,
    extra: {
      ...config.extra,
      pushEnvironment:
        process.env.DOVO_APNS_ENVIRONMENT === 'production' ? 'production' : 'sandbox',
    },
    android: {
      ...config.android,
      ...(process.env.DOVO_GOOGLE_SERVICES_FILE
        ? { googleServicesFile: process.env.DOVO_GOOGLE_SERVICES_FILE }
        : {}),
    },
    name: config.name ?? 'Dovo Studio',
    slug: config.slug ?? 'dovo-studio',
    ios: {
      ...config.ios,
      ...(process.env.DOVO_APPLE_TEAM_ID ? { appleTeamId: process.env.DOVO_APPLE_TEAM_ID } : {}),
    },
    plugins: [
      './plugins/with-cocoapods-uuids.ts',
      ['./plugins/with-live-activity-push.ts', { enabled: push || notifications }],
      ...(config.plugins ?? []).map((plugin): NonNullable<ExpoConfig['plugins']>[number] =>
        Array.isArray(plugin) && plugin[0] === 'expo-widgets'
          ? ['expo-widgets', { ...plugin[1], enablePushNotifications: push, frequentUpdates: push }]
          : plugin,
      ),
    ],
  }
}
