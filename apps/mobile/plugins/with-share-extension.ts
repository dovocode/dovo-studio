import {
  withDangerousMod,
  withXcodeProject,
  withMainActivity,
  type ConfigPlugin,
} from 'expo/config-plugins'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Expo names the generated share extension after its internal target by default.
const withShareExtension: ConfigPlugin = (config) => {
  config = withMainActivity(config, (config) => {
    const capture = 'expo.modules.dovoshareinbox.DovoShareInbox.capture(this, intent)'
    let source = config.modResults.contents
    if (!source.includes(capture)) {
      const create = /(override fun onCreate\(savedInstanceState: Bundle\?\) \{)/
      if (!create.test(source)) throw new Error('MainActivity onCreate is missing')
      source = source.replace(
        create,
        `$1\n    expo.modules.dovoshareinbox.DovoShareInbox.capture(this, intent, savedInstanceState?.getString("com.dovo.studio.shareId"))`,
      )
      const newIntent = /(override fun onNewIntent\(intent: Intent\) \{)/
      if (newIntent.test(source)) source = source.replace(newIntent, `$1\n    ${capture}`)
      else
        source = source.replace(
          /\n}\s*$/,
          `
  override fun onNewIntent(intent: android.content.Intent) {
    ${capture}
    super.onNewIntent(intent)
    setIntent(intent)
  }
}
`,
        )
      if (source.includes('override fun onSaveInstanceState(')) {
        const save = /(override fun onSaveInstanceState\((\w+): Bundle\) \{)/
        if (!save.test(source)) throw new Error('MainActivity saved state signature is unsupported')
        source = source.replace(
          save,
          '$1\n    $2.putString("com.dovo.studio.shareId", intent?.getStringExtra("com.dovo.studio.shareId"))',
        )
      } else
        source = source.replace(
          /\n}\s*$/,
          `
  override fun onSaveInstanceState(outState: android.os.Bundle) {
    outState.putString("com.dovo.studio.shareId", intent?.getStringExtra("com.dovo.studio.shareId"))
    super.onSaveInstanceState(outState)
  }
}
`,
        )
      config.modResults.contents = source
    }
    return config
  })
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
      const controller = join(
        config.modRequest.projectRoot,
        'plugins/share-inbox/ShareIntoViewController.swift',
      )
      writeFileSync(
        join(
          config.modRequest.platformProjectRoot,
          'expo-sharing-extension/ShareIntoViewController.swift',
        ),
        readFileSync(controller, 'utf8'),
      )
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
