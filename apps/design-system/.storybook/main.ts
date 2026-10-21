import tailwindcss from '@tailwindcss/vite'
import type { StorybookConfig } from '@storybook/react-vite'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const mobileRequire = createRequire(new URL('../../mobile/package.json', import.meta.url))
const expoRequire = createRequire(mobileRequire.resolve('expo/package.json'))
const expoCore = resolve(
  dirname(expoRequire.resolve('expo-modules-core/package.json')),
  'src/index.ts',
)
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
const catalogBoundary = (name: string) => fileURLToPath(new URL('./' + name, import.meta.url))
const config: StorybookConfig = {
  stories: ['../src/**/*.stories.tsx'],
  framework: '@storybook/react-vite',
  addons: ['@storybook/addon-docs', '@storybook/addon-a11y'],
  typescript: { reactDocgen: false },
  async viteFinal(config) {
    config.define = {
      ...config.define,
      __DEV__: 'false',
      'process.env.EXPO_OS': JSON.stringify('web'),
    }
    config.plugins = [
      ...(config.plugins ?? []),
      tailwindcss(),
      {
        name: 'mobile-thread-navigation-boundary',
        enforce: 'pre',
        transform(code, id) {
          // Expo's declaration-only globals import ambient classes as values. Metro erases
          // these; make their type-only intent explicit for the catalog's TS compiler.
          if (id.includes('/expo-modules-core/src/ts-declarations/global.ts'))
            return { code: code.replace(/^import \{/gm, 'import type {'), map: null }
          if (!id.endsWith('/mobile/src/ui/controls/icon-assets.ts')) return null
          const imports: string[] = []
          const transformed = code.replace(/require\('([^']+)\.png'\)/g, (_match, path: string) => {
            const name = 'catalogIcon' + imports.length
            imports.push(`import ${name} from '${path}@3x.png'`)
            return `({ uri: ${name} })`
          })
          return { code: imports.join('\n') + '\n' + transformed, map: null }
        },
        resolveId(source, importer) {
          if (
            importer &&
            source.startsWith('.') &&
            resolve(dirname(importer), source).endsWith(
              '/mobile/src/runtime/connection/peer-transport',
            )
          )
            return catalogBoundary('mobile-screen-peer.ts')
          if (
            importer &&
            source.startsWith('.') &&
            resolve(dirname(importer), source).endsWith('/mobile/src/runtime/connection/provider')
          )
            return catalogBoundary('mobile-screen-runtime.tsx')
          if (
            importer &&
            source.startsWith('.') &&
            resolve(dirname(importer), source).endsWith(
              '/mobile/src/runtime/connection/account-provider',
            )
          )
            return fileURLToPath(
              new URL('../../mobile/src/runtime/connection/account-context.ts', import.meta.url),
            )

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
      { find: /^expo-modules-core$/, replacement: expoCore },
      { find: /^react-native$/, replacement: reactNativeWeb },
      {
        find: /^react-native-web\/(.*)$/,
        replacement: resolve(dirname(reactNativeWeb), '../..') + '/$1',
      },
      { find: /^expo-router$/, replacement: catalogBoundary('mobile-screen-router.tsx') },
      {
        find: /^@react-native-async-storage\/async-storage$/,
        replacement: catalogBoundary('mobile-screen-storage.ts'),
      },
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
