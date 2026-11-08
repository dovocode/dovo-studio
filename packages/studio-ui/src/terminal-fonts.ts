/** Pass explicit font assets to terminal workers, which have their own FontFaceSet. */
export const terminalFontSources = [
  {
    family: 'JetBrains Mono Nerd Font',
    weight: '400',
    url: new URL('./assets/fonts/jetbrains-mono-nerd-regular.woff2', import.meta.url).href,
  },
  {
    family: 'JetBrains Mono Nerd Font',
    weight: '700',
    url: new URL('./assets/fonts/jetbrains-mono-nerd-bold.woff2', import.meta.url).href,
  },
]
