import { useRef, useState } from 'react'
import { Alert } from 'react-native'
import { responses, type TerminalInfo, type UpdateTerminal } from '@dovo/protocol'
import { useRuntime } from '../runtime/connection/provider'
import { useTaskLifecycle, chooseSnoozeDuration } from '../tasks/detail/use-task-lifecycle'
import { useBrowserWorkspace } from '../browser/browser-workspace'
import { moveBrowserTab, togglePinnedTab, visitTab } from '../browser/browser-state'
import { randomUUID } from 'expo-crypto'
import { Sheet } from '../ui/layout/sheet'
import { Action } from '../ui/controls/action'
import { Text } from '../ui/content/text'
import type { WorkspaceItem } from './workspace-items'

export function useTerminalActions(runtimeId: string, terminal: TerminalInfo | undefined) {
  const { overviews, readRuntime, refreshRuntime } = useRuntime()
  const owner = overviews.find((entry) => entry.profile.id === runtimeId)
  const locked = useRef(false)
  const [busy, setBusy] = useState(false)
  const update = async (changes: Omit<UpdateTerminal, 'id'>) => {
    if (!terminal || locked.current) return
    locked.current = true
    setBusy(true)
    try {
      if (!owner?.connected)
        throw new Error('Reconnect to this computer before changing the terminal.')
      await readRuntime(
        owner.profile,
        '/api/terminals/update',
        { id: terminal.id, ...changes },
        responses.terminal,
      )
      await refreshRuntime(owner.profile)
    } catch (cause: unknown) {
      Alert.alert('Could not update terminal', String(cause))
    } finally {
      locked.current = false
      setBusy(false)
    }
  }
  return { busy, disabled: busy || !owner?.connected, update }
}

export function ResourceActions({ item, onClose }: { item: WorkspaceItem; onClose: () => void }) {
  return item.kind === 'thread' ? (
    <ThreadActions item={item} onClose={onClose} />
  ) : (
    <StandaloneActions item={item} onClose={onClose} />
  )
}
function ThreadActions({
  item,
  onClose,
}: {
  item: Extract<WorkspaceItem, { kind: 'thread' }>
  onClose: () => void
}) {
  const runtime = useRuntime()
  const task =
    runtime.overviews
      .find((owner) => owner.profile.id === item.runtimeId)
      ?.snapshot?.workspace.tasks.find((task) => task.id === item.task.id) ?? item.task
  const lifecycle = useTaskLifecycle(task, item.runtimeId)
  return (
    <Sheet title={item.title} onClose={onClose}>
      <Action
        secondary
        label={task.pinned ? 'Unpin' : 'Pin'}
        disabled={!lifecycle.enabled || lifecycle.busy}
        onPress={() => {
          lifecycle.togglePinned()
        }}
      />
      <Action
        secondary
        label={task.archived ? 'Restore' : 'Settle'}
        disabled={!lifecycle.enabled || lifecycle.busy || task.status === 'running'}
        onPress={() => {
          lifecycle.toggleSettled()
        }}
      />
      <Action
        secondary
        label="Snooze"
        disabled={!lifecycle.enabled || lifecycle.busy}
        onPress={() =>
          chooseSnoozeDuration('Snooze thread', (until) => {
            lifecycle.snooze(until)
          })
        }
      />
      {!!task.snoozedUntil && (
        <Action
          secondary
          label="Wake now"
          onPress={() => {
            lifecycle.snooze(null)
          }}
        />
      )}
      {!!lifecycle.error && <Text accessibilityRole="alert">{lifecycle.error}</Text>}
    </Sheet>
  )
}
export function useStandaloneActions(item: Exclude<WorkspaceItem, { kind: 'thread' }>) {
  const browser = useBrowserWorkspace()
  const terminal = useTerminalActions(
    item.kind === 'terminal' ? item.runtimeId : '',
    item.kind === 'terminal' ? item.terminal : undefined,
  )
  const disabled =
    item.kind === 'terminal' ? terminal.disabled : !browser.loaded || !browser.writable
  const change = (action: 'pin' | 'settle' | 'wake', until?: string) => {
    if (item.kind === 'terminal') {
      void terminal.update(
        action === 'pin'
          ? { pinned: !item.pinned }
          : action === 'settle'
            ? { settled: item.section !== 'settled' }
            : { snoozedUntil: until ?? null },
      )
    } else {
      try {
        browser.change((state) =>
          action === 'pin'
            ? togglePinnedTab(state, item.tab.id)
            : (action === 'wake' && !until) || (action === 'settle' && item.section === 'settled')
              ? visitTab(state, item.tab.id)
              : moveBrowserTab(
                  state,
                  item.tab.id,
                  randomUUID(),
                  until ? Date.parse(until) : undefined,
                ),
        )
      } catch (cause: unknown) {
        Alert.alert('Could not update page', String(cause))
      }
    }
  }
  return { disabled, change }
}
function StandaloneActions({
  item,
  onClose,
}: {
  item: Exclude<WorkspaceItem, { kind: 'thread' }>
  onClose: () => void
}) {
  const { disabled, change: update } = useStandaloneActions(item)
  const change = (action: 'pin' | 'settle' | 'wake', until?: string) => {
    update(action, until)
    onClose()
  }
  return (
    <Sheet title={item.title} onClose={onClose}>
      <Text>
        {item.detail} · {item.status}
      </Text>
      <Action
        secondary
        label={item.pinned ? 'Unpin' : 'Pin'}
        disabled={disabled}
        onPress={() => change('pin')}
      />
      <Action
        secondary
        label={item.section === 'settled' ? 'Restore' : 'Settle'}
        disabled={disabled}
        onPress={() => change('settle')}
      />
      <Action
        secondary
        label="Snooze"
        disabled={disabled}
        onPress={() =>
          chooseSnoozeDuration(
            `Snooze ${item.kind === 'terminal' ? 'terminal' : 'page'}`,
            (until) => change('wake', until),
          )
        }
      />
      {item.section === 'snoozed' && (
        <Action secondary label="Wake now" disabled={disabled} onPress={() => change('wake')} />
      )}
      {item.kind === 'terminal' && (
        <>
          {!!item.terminal.activity?.message && <Text>{item.terminal.activity.message}</Text>}
          {!!item.terminal.recoverySetup && <Text>{item.terminal.recoverySetup}</Text>}
          {!!item.terminal.recoveryError && (
            <Text accessibilityRole="alert">{item.terminal.recoveryError}</Text>
          )}
          <Text>
            Idle recoverable sessions sleep when settled. Active commands continue safely on their
            computer.
          </Text>
        </>
      )}
    </Sheet>
  )
}
