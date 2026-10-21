import type { Meta, StoryObj } from '@storybook/react-native'
import { PullExample } from '../../src/catalog/pull-example'

const meta = {
  title: 'Dovo/Mobile/Pull request reviews',
  component: PullExample,
  args: { initialScenario: 'failing-review' },
  argTypes: {
    initialScenario: {
      control: 'select',
      options: ['failing-review', 'draft-pending', 'merged-approved'],
    },
  },
} satisfies Meta<typeof PullExample>
export default meta

type Story = StoryObj<typeof meta>

export const OpenChangesRequestedAndFailedChecks: StoryObj<typeof meta> = {}
export const DraftWithPendingChecks: Story = { args: { initialScenario: 'draft-pending' } }
export const MergedAndApproved: Story = { args: { initialScenario: 'merged-approved' } }
