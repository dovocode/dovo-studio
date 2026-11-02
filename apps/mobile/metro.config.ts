import path from 'node:path'
import { getDefaultConfig } from '@expo/metro-config'

const config = getDefaultConfig(__dirname)
// Workspace packages (for example @dovo/terminal) and their native modules resolve their own
// peer installs under pnpm; the app must bundle exactly one React, React Native and Expo.
const singletons = ['react', 'react-dom', 'react-native', 'expo', 'expo-modules-core']
const appOrigin = path.join(__dirname, 'package.json')
export default {
  ...config,
  resolver: {
    ...config.resolver,
    resolveRequest: (context, moduleName, platform) => {
      // The UMD entry aliases require inside its factory, preventing Metro from collecting
      // its relative dependencies. Use the package's static ESM entry on native platforms.
      const name = moduleName === 'jsonc-parser' ? 'jsonc-parser/lib/esm/main.js' : moduleName
      const singleton = singletons.some((pkg) => name === pkg || name.startsWith(`${pkg}/`))
      return context.resolveRequest(
        singleton ? { ...context, originModulePath: appOrigin } : context,
        name,
        platform,
      )
    },
  },
} satisfies typeof config
