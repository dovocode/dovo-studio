import tailwindcss from '@tailwindcss/vite'
import type { StorybookConfig } from '@storybook/react-vite'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const mobileRequire = createRequire(new URL('../../mobile/package.json', import.meta.url))
const reactNativeWeb = require.resolve('react-native-web')
const reactNativeWebAssetRegistry = resolve(
  dirname(reactNativeWeb),
  'modules/AssetRegistry/index.js',
)
const reactNativeSvgEntry = mobileRequire.resolve('react-native-svg')
const reactNativeSvg = resolve(dirname(reactNativeSvgEntry), '../module/index.js')
const mobileNativeBoundaries = fileURLToPath(
  new URL('./mobile-native-boundaries.ts', import.meta.url),
)
const mobileThreadNavigation = fileURLToPath(
  new URL('./mobile-thread-navigation.ts', import.meta.url),
)
const mobileGestureHandlerWeb = fileURLToPath(
  new URL('./mobile-gesture-handler-web.ts', import.meta.url),
)
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.tsx'],
  framework: '@storybook/react-vite',
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y'],
  typescript: { reactDocgen: false },
  async viteFinal(config) {
    config.plugins = [
      ...(config.plugins ?? []),
      tailwindcss(),
      {
        name: 'mobile-thread-navigation-boundary',
        enforce: 'pre',
        resolveId(source, importer) {
          if (
            source === './open-nested-thread' &&
            importer?.endsWith('/apps/mobile/src/tasks/list/nested-threads.tsx')
          ) {
            return mobileThreadNavigation
          }
          if (
            source === './thread-pressable' &&
            importer?.endsWith('/apps/mobile/src/tasks/list/nested-threads.tsx')
          ) {
            return mobileGestureHandlerWeb
          }
          return null
        },
      },
    ]
    config.resolve ??= {}
    config.resolve.alias = [
      ...(Array.isArray(config.resolve.alias)
        ? config.resolve.alias
        : Object.entries(config.resolve.alias ?? {}).map(([find, replacement]) => ({
            find,
            replacement,
          }))),
      { find: /^react-native$/, replacement: reactNativeWeb },
      { find: /^react-native-svg$/, replacement: reactNativeSvg },
      {
        find: /^@react-native\/assets-registry\/registry$/,
        replacement: reactNativeWebAssetRegistry,
      },
      { find: /^@expo\/ui\/swift-ui$/, replacement: mobileNativeBoundaries },
      { find: /^@expo\/ui\/swift-ui\/modifiers$/, replacement: mobileNativeBoundaries },
      { find: /^expo-glass-effect$/, replacement: mobileNativeBoundaries },
    ]
    config.resolve.extensions = [
      '.web.mjs',
      '.web.js',
      '.web.ts',
      '.web.tsx',
      ...(config.resolve.extensions ?? []),
    ]
    return config
  },
  core: { disableTelemetry: true },
}
export default config
