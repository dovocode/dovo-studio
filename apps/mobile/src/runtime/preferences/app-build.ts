import Constants from 'expo-constants'

export const appVersion = Constants.nativeAppVersion ?? Constants.expoConfig?.version ?? 'Unknown'
export const appBuild = Constants.nativeBuildVersion
export const appChannel = __DEV__
  ? 'Dev'
  : /-nightly(?:[.-]|$)/i.test(appVersion)
    ? 'Nightly'
    : null
