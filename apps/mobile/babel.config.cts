module.exports = (api: { cache(value: boolean): void }) => {
  api.cache(true)
  return { presets: ['babel-preset-expo'] }
}
