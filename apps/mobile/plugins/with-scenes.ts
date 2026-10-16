import { withDangerousMod, type ConfigPlugin } from 'expo/config-plugins'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// Expo 58 owns the scene lifecycle; only add Dovo's cold-start quick-action URL.
const withScenes: ConfigPlugin = (config) =>
  withDangerousMod(config, [
    'ios',
    (config) => {
      const path = join(
        config.modRequest.platformProjectRoot,
        config.modRequest.projectName ?? 'DovoStudio',
        'SceneDelegate.swift',
      )
      const contents = readFileSync(path, 'utf8')
      if (!contents.includes('class SceneDelegate: ExpoAppSceneDelegate'))
        throw new Error('Expo SceneDelegate changed: review the Dovo scene plugin')
      writeFileSync(path, readFileSync(join(__dirname, 'SceneDelegate.swift'), 'utf8'))
      return config
    },
  ])

export default withScenes
