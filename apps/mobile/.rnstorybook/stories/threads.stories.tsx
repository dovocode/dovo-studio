import type { Meta, StoryObj } from '@storybook/react-native'
import { ThreadsExample } from '../../src/catalog/threads-example'

const meta = {
  title: 'Dovo/Mobile/Thread activity',
  component: ThreadsExample,
  args: { disabled: false },
} satisfies Meta<typeof ThreadsExample>
export default meta

export const DeepThreadTree: StoryObj<typeof meta> = {}
export const DisabledThreadTree: StoryObj<typeof meta> = {
  args: { disabled: true },
}
