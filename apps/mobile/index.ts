// Only explicit development sessions can open the native design catalog.
if (__DEV__ && process.env.EXPO_PUBLIC_DOVO_STORYBOOK === '1') {
  require('./src/catalog/network').isolateCatalogNetwork()
  const { registerRootComponent } = require('expo')
  registerRootComponent(require('./.rnstorybook').default)
} else {
  require('expo-router/entry')
}
