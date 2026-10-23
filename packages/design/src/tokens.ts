/** Canonical Dovo palette. Other Studio themes remain user choices. */
export const dovoColors = {
  dark: {
    background: '#080808',
    foreground: '#ededed',
    sidebar: '#0c0c0c',
    card: '#101010',
    popover: '#101010',
    secondary: '#102432',
    'muted-foreground': '#a1a1a1',
    border: '#202020',
    primary: '#7cc9ff',
    'primary-foreground': '#080808',
    selection: '#102432',
    action: '#ededed',
    'action-foreground': '#080808',
    signal: '#bcefff',
    pink: '#7cc9ff',
    'syntax-function': '#7cc9ff',
    'syntax-keyword': '#7cc9ff',
  },
  light: {
    background: '#ffffff',
    foreground: '#151515',
    sidebar: '#f7f7f7',
    card: '#ffffff',
    popover: '#ffffff',
    secondary: '#e7f3ff',
    'muted-foreground': '#666666',
    border: '#e8e8e8',
    primary: '#0965b5',
    'primary-foreground': '#ffffff',
    selection: '#e7f3ff',
    action: '#151515',
    'action-foreground': '#ffffff',
    signal: '#005f76',
    pink: '#0965b5',
    'syntax-function': '#0965b5',
    'syntax-keyword': '#0965b5',
  },
} as const

/** Normal status palette. States also retain their icons and text. */
export const semanticColors = {
  dark: {
    success: '#8ad5b0',
    error: '#ff7e97',
    warning: '#e7c681',
    done: '#b79bf5',
    onError: '#341520',
  },
  light: {
    success: '#08734f',
    error: '#ba2549',
    warning: '#855700',
    done: '#7046b5',
    onError: '#ffffff',
  },
} as const

/** GitHub / Primer blue-orange colorblind palette, with readable light-mode accent shades. */
export const colorVisionColors = {
  dark: {
    success: '#58a6ff',
    error: '#f0883e',
    warning: '#d29922',
    done: '#b7bdc8',
    onError: '#241000',
  },
  light: {
    success: '#0550ae',
    error: '#953800',
    warning: '#7d4e00',
    done: '#6639ba',
    onError: '#ffffff',
  },
} as const

/** Stronger status colors are enabled only by the Higher contrast preference. */
export const highContrastStatusColors = {
  default: {
    dark: {
      success: '#ace8c6',
      error: '#ffb3c3',
      warning: '#ffe09c',
      done: '#d3abff',
      onError: '#341520',
    },
    light: {
      success: '#005638',
      error: '#8a1734',
      warning: '#603700',
      done: '#512598',
      onError: '#ffffff',
    },
  },
  'blue-orange': {
    dark: {
      success: '#addcff',
      error: '#ffb757',
      warning: '#f0b72f',
      done: '#d3abff',
      onError: '#241000',
    },
    light: {
      success: '#023b95',
      error: '#702c00',
      warning: '#603700',
      done: '#512598',
      onError: '#ffffff',
    },
  },
} as const

export const designTokens = {
  font: {
    sans: "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  },
  radius: { control: 6, card: 12, composer: 12 },
  spacing: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, section: 32 },
  touchTarget: 44,
  focusWidth: 2,
} as const

export function cssVariables(mode: keyof typeof dovoColors) {
  return (
    Object.entries(dovoColors[mode])
      .map(([name, value]) => '--dovo-' + name + ':' + value + ';')
      .join('') +
    Object.entries(semanticColors[mode])
      .map(([name, value]) => '--dovo-status-' + name + ':' + value + ';')
      .join('') +
    '--dovo-font-sans:' +
    designTokens.font.sans +
    ';--dovo-font-mono:' +
    designTokens.font.mono +
    ';' +
    Object.entries(designTokens.radius)
      .map(([name, value]) => '--dovo-radius-' + name + ':' + value + 'px;')
      .join('')
  )
}
export const tokenStyles =
  ':root{' + cssVariables('dark') + '}\n:root[data-theme="light"]{' + cssVariables('light') + '}'
