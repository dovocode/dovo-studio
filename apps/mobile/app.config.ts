import type { ConfigContext, ExpoConfig } from 'expo/config'
export default ({ config }: ConfigContext): ExpoConfig => {
  const push = process.env.DOVO_LIVE_ACTIVITY_PUSH === '1'
  return {
    ...config,
    name: config.name ?? 'Dovo Studio',
    slug: config.slug ?? 'dovo-studio',
    ios: {
      ...config.ios,
      ...(process.env.DOVO_APPLE_TEAM_ID ? { appleTeamId: process.env.DOVO_APPLE_TEAM_ID } : {}),
    },
    plugins: [
      ['./plugins/with-live-activity-push.ts', { enabled: push }],
      ...(config.plugins ?? []).map((plugin): NonNullable<ExpoConfig['plugins']>[number] =>
        Array.isArray(plugin) && plugin[0] === 'expo-widgets'
          ? ['expo-widgets', { ...plugin[1], enablePushNotifications: push }]
          : plugin,
      ),
    ],
  }
}
