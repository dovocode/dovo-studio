import { withAndroidManifest, type ConfigPlugin } from 'expo/config-plugins'

// The replacement inherits Expo's token/ordinary-notification handling. Only one FCM
// service may own MESSAGING_EVENT, otherwise Android can silently choose the wrong one.
const withQuestionNotifications: ConfigPlugin = (config) =>
  withAndroidManifest(config, (mod) => {
    mod.modResults.manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools'
    const application = mod.modResults.manifest.application?.[0]
    if (!application) throw new Error('Missing Android application')
    const name = 'expo.modules.notifications.service.ExpoFirebaseMessagingService'
    application.service = [
      ...(application.service ?? []).filter((service) => service.$['android:name'] !== name),
      { $: { 'android:name': name, 'tools:node': 'remove' } },
    ]
    return mod
  })

export default withQuestionNotifications
