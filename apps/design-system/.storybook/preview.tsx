import type { Preview } from '@storybook/react-vite'
import { useLayoutEffect } from 'react'
import { dovoColors } from '@dovo/design'
import '../src/catalog.css'

function Theme({ mode, children }: { mode: 'light' | 'dark'; children: React.ReactNode }) {
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = mode
    document.documentElement.classList.toggle('dark', mode === 'dark')
    document.documentElement.dataset.motion = 'system'
    document.documentElement.style.colorScheme = mode
    for (const [key, value] of Object.entries(dovoColors[mode]))
      document.documentElement.style.setProperty('--' + key, value)
  }, [mode])
  return (
    <div
      style={{
        padding: 24,
        minHeight: '100vh',
        background: dovoColors[mode].background,
        color: dovoColors[mode].foreground,
      }}
    >
      {children}
    </div>
  )
}
const preview: Preview = {
  globalTypes: {
    theme: {
      description: 'Dovo color mode',
      toolbar: { icon: 'paintbrush', items: ['dark', 'light'], dynamicTitle: true },
    },
  },
  initialGlobals: { theme: 'dark', a11y: { manual: true } },
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'error' },
    controls: { expanded: true },
    options: {
      storySort: {
        order: [
          'Dovo',
          [
            'Build screens',
            'Foundations',
            'Anatomy',
            'Primitives',
            'Button playground',
            'Selection',
            'Controls',
            'Composers',
            '*',
          ],
        ],
      },
    },
  },
  decorators: [
    (Story, context) => (
      <Theme mode={context.globals.theme === 'light' ? 'light' : 'dark'}>
        <Story />
      </Theme>
    ),
  ],
}
export default preview
