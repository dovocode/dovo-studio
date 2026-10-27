import { useRef, useState } from 'react'
import { websiteCustomizationProposal, type BrowserWebsiteCustomization } from '@dovo/protocol'
import { RuntimeScope, useRuntime } from '../runtime/connection/provider'
import { TaskDetail } from '../tasks/detail/task-detail'
import { Sheet, type SheetHandle } from '../ui/layout/sheet'
import { Action } from '../ui/controls/action'
import { SearchField } from '../ui/controls/field'
import { Text } from '../ui/content/text'
import type { BrowserTab } from './browser-state'

export function BrowserThreadPanel({
  runtimeId,
  thread,
  onThread,
  onClose,
  origin,
  onProposal,
}: {
  runtimeId?: string
  thread?: BrowserTab['thread']
  onThread: (thread: NonNullable<BrowserTab['thread']>) => Promise<void>
  onClose: () => void
  origin?: string
  onProposal: (proposal: BrowserWebsiteCustomization) => void
}) {
  const runtime = useRuntime()
  const sheet = useRef<SheetHandle>(null)
  const matchingThread = thread?.runtimeId === runtimeId ? thread : undefined
  const [choosing, setChoosing] = useState(!matchingThread)
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const choose = async (value: NonNullable<BrowserTab['thread']>) => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      if (!runtimeId || value.runtimeId !== runtimeId)
        throw new Error('Choose a thread on this tab’s computer.')
      await onThread(value)
      setChoosing(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet
      ref={sheet}
      title="Thread for this tab"
      scrollable={choosing}
      onClose={onClose}
      busy={busy}
      headerAction={
        matchingThread
          ? {
              label: choosing ? 'Back' : 'Change thread',
              icon: 'chat',
              onPress: () => setChoosing(!choosing),
            }
          : undefined
      }
    >
      {error ? <Text accessibilityRole="alert">{error}</Text> : null}
      {thread && !matchingThread ? (
        <Text>
          Choose a thread on this tab’s computer. The saved thread belongs to another computer.
        </Text>
      ) : null}
      {!runtimeId ? (
        <Text>Thread panels require a browser tab on a paired computer.</Text>
      ) : choosing ? (
        <>
          <SearchField label="Find thread for tab" value={query} onChangeText={setQuery} />
          {runtime.overviews
            .filter((entry) => entry.profile.id === runtimeId)
            .flatMap((entry) =>
              (entry.snapshot?.workspace.tasks ?? [])
                .filter(
                  (task) =>
                    !task.archived &&
                    !task.example &&
                    `${task.title} ${entry.profile.name}`
                      .toLowerCase()
                      .includes(query.toLowerCase()),
                )
                .map((task) => (
                  <Action
                    key={`${entry.profile.id}:${task.id}`}
                    label={`${task.title || 'Untitled thread'} · ${entry.profile.name}`}
                    secondary
                    disabled={!entry.connected || busy}
                    onPress={() => void choose({ id: task.id, runtimeId: entry.profile.id })}
                  />
                )),
            )}
        </>
      ) : matchingThread ? (
        <RuntimeScope runtimeId={matchingThread.runtimeId}>
          <Thread
            id={matchingThread.id}
            onClose={onClose}
            origin={origin}
            onProposal={(proposal) => sheet.current?.dismiss(() => onProposal(proposal))}
          />
        </RuntimeScope>
      ) : null}
    </Sheet>
  )
}

function Thread({
  id,
  onClose,
  origin,
  onProposal,
}: {
  id: string
  onClose: () => void
  origin?: string
  onProposal: (proposal: BrowserWebsiteCustomization) => void
}) {
  const runtime = useRuntime()
  const task = runtime.snapshot?.workspace.tasks.find((task) => task.id === id)
  if (!task)
    return <Text>This thread is unavailable. Reconnect its computer or choose another thread.</Text>
  const proposal = origin && websiteCustomizationProposal(task.messages, origin)
  return (
    <TaskDetail
      task={task}
      onBack={onClose}
      parentNavigation={
        proposal ? (
          <Action label="Review website changes" onPress={() => onProposal(proposal)} />
        ) : undefined
      }
    />
  )
}
