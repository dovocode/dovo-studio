module.exports = ({ config }) => {
  const push = process.env.DOVO_LIVE_ACTIVITY_PUSH === '1'
  return {
    ...config,
    ios: {
      ...config.ios,
      ...(process.env.DOVO_APPLE_TEAM_ID ? { appleTeamId: process.env.DOVO_APPLE_TEAM_ID } : {}),
    },
    plugins: [
      ['./plugins/with-live-activity-push.cjs', { enabled: push }],
      ...config.plugins.map((plugin) =>
        Array.isArray(plugin) && plugin[0] === 'expo-widgets'
          ? ['expo-widgets', { ...plugin[1], enablePushNotifications: push }]
          : plugin,
      ),
    ],
  }
}
