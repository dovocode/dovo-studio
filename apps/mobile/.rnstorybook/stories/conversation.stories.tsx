import type { Meta, StoryObj } from '@storybook/react-native'
import { ConversationExample } from '../../src/catalog/conversation-example'
const meta = {
  title: 'Dovo/Mobile/Conversation inputs',
  component: ConversationExample,
  args: { disconnected: false },
} satisfies Meta<typeof ConversationExample>
export default meta
export const DraftAndQuestions: StoryObj<typeof meta> = {}
export const Disconnected: StoryObj<typeof meta> = { args: { disconnected: true } }
