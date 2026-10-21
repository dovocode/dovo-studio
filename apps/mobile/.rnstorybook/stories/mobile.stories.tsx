import type { Meta, StoryObj } from '@storybook/react-native'
import { SettingsExample } from '../../src/catalog/settings-example'

const meta = {
  title: 'Dovo/Mobile/Settings',
  component: SettingsExample,
  args: { initialState: 'idle' },
  argTypes: { initialState: { control: 'select', options: ['idle', 'saving', 'error'] } },
} satisfies Meta<typeof SettingsExample>
export default meta
export const Settings: StoryObj<typeof meta> = {}
export const SaveFailure: StoryObj<typeof meta> = { args: { initialState: 'error' } }
export const Saving: StoryObj<typeof meta> = { args: { initialState: 'saving' } }
