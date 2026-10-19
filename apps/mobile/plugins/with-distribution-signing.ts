import { withAppBuildGradle, type ConfigPlugin } from 'expo/config-plugins'

/** Generated Gradle reads private upload credentials at build time, never from checked-in files. */
const withDistributionSigning: ConfigPlugin = (config) => {
  if (process.env.DOVO_MOBILE_DISTRIBUTION !== '1') return config
  for (const key of [
    'DOVO_ANDROID_KEYSTORE',
    'DOVO_ANDROID_STORE_PASSWORD',
    'DOVO_ANDROID_KEY_ALIAS',
    'DOVO_ANDROID_KEY_PASSWORD',
  ])
    if (!process.env[key]) throw new Error(`Set ${key} for an Android store build`)
  return withAppBuildGradle(config, (mod) => {
    if (mod.modResults.language !== 'groovy')
      throw new Error('Expected the Expo Groovy app build file')
    const marker = '// Dovo store upload signing begin'
    mod.modResults.contents = mod.modResults.contents.replace(
      /\n?\/\/ Dovo store upload signing begin[\s\S]*?\/\/ Dovo store upload signing end\n?/g,
      '',
    )
    mod.modResults.contents += `
${marker}
android {
    signingConfigs {
        dovoUpload {
            storeFile file(System.getenv("DOVO_ANDROID_KEYSTORE"))
            storePassword System.getenv("DOVO_ANDROID_STORE_PASSWORD")
            keyAlias System.getenv("DOVO_ANDROID_KEY_ALIAS")
            keyPassword System.getenv("DOVO_ANDROID_KEY_PASSWORD")
        }
    }
    buildTypes { release { signingConfig signingConfigs.dovoUpload } }
}
// Dovo store upload signing end
`
    return mod
  })
}
export default withDistributionSigning
