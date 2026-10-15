import { getDefaultConfig } from '@expo/metro-config'

const config = getDefaultConfig(__dirname)
export default {
  ...config,
  resolver: {
    ...config.resolver,
    // The UMD entry aliases require inside its factory, preventing Metro from collecting
    // its relative dependencies. Use the package's static ESM entry on native platforms.
    resolveRequest: (context, moduleName, platform) =>
      context.resolveRequest(
        context,
        moduleName === 'jsonc-parser' ? 'jsonc-parser/lib/esm/main.js' : moduleName,
        platform,
      ),
  },
} satisfies typeof config
