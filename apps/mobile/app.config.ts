import type { ConfigContext, ExpoConfig } from 'expo/config'
export default ({ config }: ConfigContext): ExpoConfig => {
  const push =
    process.env.DOVO_LIVE_ACTIVITY_PUSH !== '0' && process.env.DOVO_PUSH_NOTIFICATIONS !== '0'
  const buildNumber = process.env.DOVO_MOBILE_BUILD_NUMBER
  if (buildNumber && (!/^[1-9][0-9]*$/.test(buildNumber) || Number(buildNumber) > 2_100_000_000))
    throw new Error('Invalid DOVO_MOBILE_BUILD_NUMBER')
  const channel = process.env.DOVO_MOBILE_CHANNEL ?? (buildNumber ? 'nightly' : 'dev')
  if (!['stable', 'nightly', 'dev'].includes(channel))
    throw new Error('Invalid DOVO_MOBILE_CHANNEL')
  const notifications = process.env.DOVO_PUSH_NOTIFICATIONS !== '0'
  return {
    ...config,
    extra: {
      ...config.extra,
      releaseChannel: channel,
      sourceCommit: process.env.DOVO_SOURCE_COMMIT ?? process.env.GITHUB_SHA ?? null,
      pushEnvironment:
        process.env.DOVO_APNS_ENVIRONMENT === 'production' ? 'production' : 'sandbox',
    },
    android: {
      ...config.android,
      ...(buildNumber ? { versionCode: Number(buildNumber) } : {}),
      ...(process.env.DOVO_GOOGLE_SERVICES_FILE
        ? { googleServicesFile: process.env.DOVO_GOOGLE_SERVICES_FILE }
        : {}),
    },
    name: config.name ?? 'Dovo Studio',
    slug: config.slug ?? 'dovo-studio',
    ios: {
      ...config.ios,
      ...(buildNumber ? { buildNumber } : {}),
      ...(process.env.DOVO_APPLE_TEAM_ID ? { appleTeamId: process.env.DOVO_APPLE_TEAM_ID } : {}),
    },
    plugins: [
      './plugins/with-cocoapods-uuids.ts',
      ...(process.env.DOVO_MOBILE_DISTRIBUTION === '1'
        ? ['./plugins/with-distribution-signing.ts']
        : []),
      './plugins/with-lucide-icons.ts',
      './plugins/with-question-notifications.ts',
      ['./plugins/with-live-activity-push.ts', { enabled: push || notifications }],
      ...(config.plugins ?? []).map((plugin): NonNullable<ExpoConfig['plugins']>[number] =>
        Array.isArray(plugin) && plugin[0] === 'expo-widgets'
          ? ['expo-widgets', { ...plugin[1], enablePushNotifications: push, frequentUpdates: push }]
          : plugin,
      ),
    ],
  }
}
