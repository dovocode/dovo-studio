import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  SettingsExample,
  type SettingsExampleState,
} from '../../mobile/src/catalog/settings-example'
import { MobilePreview } from './mobile-preview'

const meta = {
  title: 'Dovo/Mobile/Settings',
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          'Production mobile settings groups, rows, switches, choices, fields, actions and confirmation sheet. The shared SettingsExample is React Native-only and also mounts in the native catalog. All values and saves are local fixtures.',
      },
    },
  },
} satisfies Meta
export default meta

function Preview({
  initialState,
  mode,
}: {
  initialState?: SettingsExampleState
  mode: 'light' | 'dark'
}) {
  return (
    <MobilePreview mode={mode}>
      <SettingsExample initialState={initialState} />
    </MobilePreview>
  )
}

export const SettingsNavigationAndEditor: StoryObj = {
  render: (_, context) => (
    <MobilePreview mode={context.globals.theme === 'light' ? 'light' : 'dark'}>
      <SettingsExample />
    </MobilePreview>
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Open Runtime address from the grouped index, edit the local field, choose save scope, and save or cancel. The editor also supports a simulated pending save, one simulated failure with retry, a local disabled state, and a native confirmation sheet for forgetting the saved address. Try narrow viewport and increased text size to inspect responsive labels and touch controls. No runtime or network call is made.',
      },
    },
  },
}

export const SettingsLoading: StoryObj = {
  render: (_, context) => (
    <Preview initialState="saving" mode={context.globals.theme === 'light' ? 'light' : 'dark'} />
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Starts with a pending local save. Complete local save resolves it; the fixture performs no background operation or service call.',
      },
    },
  },
}

export const SettingsErrorAndRetry: StoryObj = {
  render: (_, context) => (
    <Preview initialState="error" mode={context.globals.theme === 'light' ? 'light' : 'dark'} />
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Starts with an explicit local save error and a Retry save action. Retry updates only the displayed fixture state and preserves the draft until it succeeds.',
      },
    },
  },
}
