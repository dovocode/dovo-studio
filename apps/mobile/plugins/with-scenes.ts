import { withAppDelegate, withInfoPlist, type ConfigPlugin } from 'expo/config-plugins'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// SDK 57's template predates the scene lifecycle required by the iOS 27 SDK.
const withScenes: ConfigPlugin = (config) => {
  config = withInfoPlist(config, (config) => {
    config.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
          },
        ],
      },
    }
    return config
  })
  return withAppDelegate(config, (config) => {
    if (config.modResults.language !== 'swift') throw new Error('Dovo requires a Swift AppDelegate')
    const delegate = readFileSync(join(__dirname, 'SceneDelegate.swift'), 'utf8')
    const marker =
      '// Kept beside the config plugin so Expo prebuild reproduces native lifecycle support.'
    const existing = config.modResults.contents.indexOf(marker)
    if (existing >= 0) {
      const end = config.modResults.contents.indexOf('\n}', existing)
      if (end < 0) throw new Error('Dovo SceneDelegate is incomplete: review the scene plugin')
      config.modResults.contents =
        config.modResults.contents.slice(0, existing) +
        delegate.trimEnd() +
        config.modResults.contents.slice(end + 2)
      return config
    }
    if (config.modResults.contents.includes('class SceneDelegate:'))
      throw new Error('Existing SceneDelegate is not managed by Dovo: review the scene plugin')
    const startup =
      /#if os\(iOS\) \|\| os\(tvOS\)\s+window = UIWindow\(frame: UIScreen\.main\.bounds\)[\s\S]*?#endif/
    if (!startup.test(config.modResults.contents))
      throw new Error('Expo AppDelegate changed: review the Dovo scene plugin')
    config.modResults.contents = config.modResults.contents.replace(startup, '') + '\n' + delegate
    return config
  })
}

export default withScenes
