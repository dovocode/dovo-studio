import type { Meta, StoryObj } from '@storybook/react-vite'
import { ThreadsExample } from '../../mobile/src/catalog/threads-example'
import { MobilePreview } from './mobile-preview'

const meta = {
  title: 'Dovo/Mobile/Thread activity',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Production NestedThreads activity cards with a synthetic deep tree. This catalogs the spawned-thread presentation used within task rows; the full TaskListRow is not shown because it depends on lifecycle, model-cache, runtime-selector, car-mode, swipe and menu providers. Fixture navigation remains disabled when no runtime IDs resolve; failure acknowledgements update local story state. The browser uses React Native Web Pressable and does not verify native swipe gesture cancellation.',
      },
    },
  },
} satisfies Meta
export default meta

export const DeepThreadTree: StoryObj = {
  render: (_, context) => (
    <MobilePreview mode={context.globals.theme === 'light' ? 'light' : 'dark'}>
      <ThreadsExample />
    </MobilePreview>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Shows needs-input, running, nested running, failed, offline/saved, partial and completed children. Expand/collapse thread groups and acknowledge the local failure; child rows never route out of this story.',
      },
    },
  },
}

export const DisabledThreadTree: StoryObj = {
  render: (_, context) => (
    <MobilePreview mode={context.globals.theme === 'light' ? 'light' : 'dark'}>
      <ThreadsExample disabled />
    </MobilePreview>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Shows the production child rows in a disabled state while the thread owner is unavailable. The summary and completed group remain readable.',
      },
    },
  },
}
