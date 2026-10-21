import type { Meta, StoryObj } from '@storybook/react-vite'
import { useLayoutEffect, useMemo, useState } from 'react'
import { InputPreviewWindow } from '../../desktop/src/input-preview'
import { WindowsRuntimeGate } from '../../../packages/extension-runtime/src/windows-runtime'
import {
  decode,
  pendingQuestionSchema,
  type InputPreview,
  type InputPreviewBridge,
  type WindowsRuntimeBridge,
} from '../../../packages/protocol/src'
import { DesktopScreenFixture } from './desktop-screens-fixture'

const meta = {
  title: 'Dovo/Screens/Desktop utility windows',
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component:
          'Actual desktop permission/question utility window and Windows environment onboarding. Bridges are synthetic and cannot communicate with Electron, install WSL, read security logs, or answer a real request. These render utility-window contents, not operating-system window chrome.',
      },
    },
  },
} satisfies Meta
export default meta
type Story = StoryObj<typeof meta>
function InputPreviewExample({
  question = false,
  offline = false,
  fail = false,
}: {
  question?: boolean
  offline?: boolean
  fail?: boolean
}) {
  const [answered, setAnswered] = useState(false)
  const value = useMemo<InputPreview>(
    () => ({
      key: `preview-${question ? 'question' : 'approval'}`,
      waiting: 2,
      runtimeId: 'preview-computer',
      runtimeName: 'Preview computer',
      taskTitle: 'Review shared sidebar components',
      connected: !offline,
      request: question
        ? {
            kind: 'question',
            value: decode(pendingQuestionSchema, {
              id: 'preview-question',
              taskId: 'preview-task',
              createdAt: '2026-10-21T10:00:00.000Z',
              prompt: {
                title: 'Choose the sidebar layout',
                questions: [
                  {
                    id: 'layout',
                    header: 'Layout',
                    question: 'Which sidebar layout should be used?',
                    options: [
                      {
                        value: 'compact',
                        label: 'Compact',
                        description: 'Keep more space for content.',
                      },
                      {
                        value: 'comfortable',
                        label: 'Comfortable',
                        description: 'Use larger navigation rows.',
                      },
                    ],
                  },
                ],
              },
            }),
          }
        : {
            kind: 'approval',
            value: {
              id: 'preview-approval',
              taskId: 'preview-task',
              title: 'Run component checks?',
              detail: 'pnpm --filter @dovo/design-system typecheck',
              createdAt: '2026-10-21T10:00:00.000Z',
            },
          },
    }),
    [question, offline],
  )
  const bridge = useMemo<InputPreviewBridge>(
    () => ({
      sync: async () => undefined,
      current: async () => value,
      subscribe: () => () => undefined,
      answer: async () => {
        if (fail) throw new Error('Synthetic answer could not be saved. Please retry.')
        setAnswered(true)
      },
      dismiss: async () => setAnswered(true),
      openThread: async () => setAnswered(true),
      onOpenThread: () => () => undefined,
    }),
    [value, fail],
  )
  return (
    <DesktopScreenFixture state="populated" navigate={() => undefined}>
      {answered ? (
        <p role="status" className="p-6">
          Preview dismissed or answered locally.
        </p>
      ) : (
        <InputPreviewWindow bridge={bridge} />
      )}
    </DesktopScreenFixture>
  )
}
export const PermissionWindow: Story = { render: () => <InputPreviewExample /> }
export const QuestionWindow: Story = { render: () => <InputPreviewExample question /> }
export const DisconnectedInputWindow: Story = { render: () => <InputPreviewExample offline /> }
export const FailedInputWindow: Story = { render: () => <InputPreviewExample fail /> }

function WindowsOnboardingExample({ failure = false }: { failure?: boolean }) {
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  useLayoutEffect(() => {
    const previous = Object.getOwnPropertyDescriptor(window, 'dovo')
    if (previous) {
      setError('This preview requires an isolated browser without a desktop bridge.')
      return
    }
    const windowsRuntime: WindowsRuntimeBridge = {
      read: async () => {
        if (failure) throw new Error('Synthetic WSL discovery failed.')
        return {
          configured: false,
          choice: { mode: 'native' },
          distributions: [
            { name: 'Ubuntu', version: 2 },
            { name: 'Debian', version: 2 },
          ],
        }
      },
      connection: async () => ({
        address: 'http://preview.invalid:51464',
        token: 'synthetic-preview-token',
      }),
      save: async () => ({
        address: 'http://preview.invalid:51464',
        token: 'synthetic-preview-token',
      }),
      security: async () => ({
        checkedAt: '2026-10-21T10:00:00.000Z',
        status: 'unavailable',
        events: [],
      }),
    }
    Object.defineProperty(window, 'dovo', { configurable: true, value: { windowsRuntime } })
    setReady(true)
    return () => {
      Reflect.deleteProperty(window, 'dovo')
    }
  }, [failure])
  return error ? (
    <p role="alert">{error}</p>
  ) : ready ? (
    <WindowsRuntimeGate>
      <p role="status" className="p-6">
        Synthetic environment selected. No runtime was installed or started.
      </p>
    </WindowsRuntimeGate>
  ) : (
    <p role="status">Preparing isolated Windows bridge…</p>
  )
}
export const WindowsOnboarding: Story = { render: () => <WindowsOnboardingExample /> }
export const WindowsDiscoveryError: Story = { render: () => <WindowsOnboardingExample failure /> }
