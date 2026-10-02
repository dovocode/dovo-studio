import { withDangerousMod, withXcodeProject, type ConfigPlugin } from 'expo/config-plugins'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Expo names the generated share extension after its internal target by default.
const withShareExtension: ConfigPlugin = (config) => {
  config = withXcodeProject(config, (config) => {
    const configurations = config.modResults.pbxXCBuildConfigurationSection()
    for (const entry of Object.values(configurations)) {
      if (typeof entry !== 'object' || !entry || !('buildSettings' in entry)) continue
      const settings = entry.buildSettings
      if (typeof settings !== 'object' || !settings || !('INFOPLIST_FILE' in settings)) continue
      if (settings.INFOPLIST_FILE !== '"expo-sharing-extension/Info.plist"') continue
      Object.assign(settings, {
        INFOPLIST_KEY_CFBundleDisplayName: '"Dovo Studio"',
        ...(config.ios?.appleTeamId ? { DEVELOPMENT_TEAM: config.ios.appleTeamId } : {}),
      })
    }
    return config
  })
  return withDangerousMod(config, [
    'ios',
    (config) => {
      const path = join(config.modRequest.platformProjectRoot, 'expo-sharing-extension/Info.plist')
      const contents = readFileSync(path, 'utf8')
      const displayName = /(<key>CFBundleDisplayName<\/key>\s*<string>)[^<]*(<\/string>)/
      if (!displayName.test(contents))
        throw new Error('Expo share extension display name is missing')
      writeFileSync(path, contents.replace(displayName, '$1Dovo Studio$2'))
      return config
    },
  ])
}

export default withShareExtension
