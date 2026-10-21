import type { Meta, StoryObj } from '@storybook/react-native'
import { studioThemeIds } from '@dovo/studio-core/themes'
import { MobileControlsExample } from '../../src/catalog/controls-example'

const meta = {
  title: 'Dovo/Mobile/Controls',
  component: MobileControlsExample,
  args: { palette: 'dovo', mode: 'dark' },
  argTypes: {
    mode: { control: 'radio', options: ['dark', 'light'] },
    palette: { control: 'select', options: [...studioThemeIds] },
  },
} satisfies Meta<typeof MobileControlsExample>
export default meta
export const Dark: StoryObj<typeof meta> = {}
export const Light: StoryObj<typeof meta> = { args: { mode: 'light' } }
