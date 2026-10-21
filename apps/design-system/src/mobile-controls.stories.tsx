import type { Meta, StoryObj } from '@storybook/react-vite'
import { MobileControlsExample } from '../../mobile/src/catalog/controls-example'
import { MobilePreview } from './mobile-preview'

const meta = {
  title: 'Dovo/Mobile/Controls',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Production mobile fields, choices, switches, actions, pills and text with local state. React Native Web shows the web rendering path; native platform chrome and native-only controls require simulator review.',
      },
    },
  },
} satisfies Meta
export default meta

export const FieldsChoicesAndActions: StoryObj = {
  render: (_, context) => (
    <MobilePreview mode={context.globals.theme === 'light' ? 'light' : 'dark'}>
      <MobileControlsExample mode={context.globals.theme === 'light' ? 'light' : 'dark'} />
    </MobilePreview>
  ),
}
