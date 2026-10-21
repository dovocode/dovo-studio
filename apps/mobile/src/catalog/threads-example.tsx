import { useState } from 'react'
import { View } from 'react-native'
import type { NestedThread } from '@dovo/protocol'
import { NestedThreads } from '../tasks/list/nested-threads'
import { RuntimeContext } from '../runtime/connection/context'
import { Text } from '../ui/content/text'
import { useTheme } from '../ui/theme'
import { disconnectedRuntime } from './disconnected-runtime'

const thread: NestedThread = {
  key: 'local:task-root',
  runtimeId: null,
  threadId: 'task-root',
  title: 'Improve the connection settings flow',
  projectName: 'Dovo Studio',
  computerName: 'This phone',
  phase: 'running',
  online: true,
  paused: false,
  children: [
    {
      key: 'local:child-needs-input',
      runtimeId: null,
      threadId: 'child-needs-input',
      title: 'Review the mobile settings accessibility states',
      projectName: 'Dovo Studio',
      computerName: 'This phone',
      phase: 'needs-input',
      needsInput: true,
      online: true,
      paused: false,
      activity: 'Waiting for an answer about the narrow-screen layout.',
      children: [],
    },
    {
      key: 'local:child-running',
      runtimeId: null,
      threadId: 'child-running',
      title: 'Check runtime address validation and error recovery',
      projectName: 'Dovo Studio',
      computerName: 'This phone',
      phase: 'running',
      online: true,
      paused: false,
      activity: 'Comparing saved and draft connection values.',
      children: [
        {
          key: 'local:grandchild-running',
          runtimeId: null,
          threadId: 'grandchild-running',
          title: 'Trace validation through the settings editor',
          projectName: 'Dovo Studio',
          computerName: 'This phone',
          phase: 'running',
          online: true,
          paused: false,
          activity: 'Inspecting the save boundary.',
          children: [],
        },
      ],
    },
    {
      key: 'local:child-failed',
      runtimeId: null,
      threadId: 'child-failed',
      title: 'Check the stale cached-data edge case',
      projectName: 'Dovo Studio',
      computerName: 'This phone',
      phase: 'failed',
      failureKey: 'failure-child-failed',
      online: true,
      paused: false,
      activity: 'The local fixture preserves this failure until acknowledged.',
      children: [],
    },
    {
      key: 'local:child-offline',
      runtimeId: null,
      threadId: 'child-offline',
      title: 'Inspect an offline child with saved state',
      projectName: 'Dovo Studio',
      computerName: 'Paired computer',
      phase: 'waiting',
      online: false,
      paused: true,
      partial: true,
      activity: 'Last saved before this computer went offline.',
      children: [],
    },
    {
      key: 'local:child-completed',
      runtimeId: null,
      threadId: 'child-completed',
      title: 'Finish the local settings fixture',
      projectName: 'Dovo Studio',
      computerName: 'This phone',
      phase: 'completed',
      online: true,
      paused: false,
      children: [],
    },
  ],
}

/** Production nested-thread UI with synthetic tree state and no runtime or navigation effects. */
export function ThreadsExample({ disabled = false }: { disabled?: boolean }) {
  const { colors } = useTheme()
  const [acknowledged, setAcknowledged] = useState<string[]>([])
  return (
    <RuntimeContext.Provider value={disconnectedRuntime}>
      <View style={{ padding: 12, gap: 8 }}>
        <Text style={{ color: colors.text, fontSize: 18, fontWeight: '700' }}>
          Spawned thread activity
        </Text>
        <Text style={{ color: colors.muted, fontSize: 13, lineHeight: 18 }}>
          Synthetic deep thread tree · local failure acknowledgement only; child navigation is
          disabled.
        </Text>
        <NestedThreads
          thread={thread}
          disabled={disabled}
          acknowledgedFailures={acknowledged}
          onAcknowledgeFailure={(key) =>
            setAcknowledged((current) => (current.includes(key) ? current : [...current, key]))
          }
        />
      </View>
    </RuntimeContext.Provider>
  )
}
