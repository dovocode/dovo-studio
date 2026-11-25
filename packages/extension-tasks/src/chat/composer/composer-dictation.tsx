import { useEffect, useRef, useSyncExternalStore, type RefObject } from 'react'
import { desktopDictationBridge } from '@dovo/protocol'
import { composerRecoveryKey, useAppPreferences, useWorkspace } from '@dovo/studio-core'
import { dictationSession } from '@dovo/studio-core/dictation-session'
import { useRuntimeDictationBridge } from '@dovo/studio-core/runtime-dictation'
import { Button, IconButton } from '@dovo/studio-ui'
import { Mic, Square, LoaderCircle } from 'lucide-react'
import type { createComposerDraft } from './composer-draft'
import { recordDictation, insertDictation } from './dictation-audio'
import { composerSelection } from './composer-input'

export function ComposerDictation({
  controller,
  taskId,
  input,
  disabled,
  onActive,
  transientId,
}: {
  taskId: string
  controller: ReturnType<typeof createComposerDraft>
  input: RefObject<HTMLElement | null>
  disabled: boolean
  onActive: (active: boolean) => void
  transientId?: string
}) {
  const { request, connection, snapshot, workspace } = useWorkspace()
  const preferences = useAppPreferences()
  const threadScope = composerRecoveryKey(connection, taskId)
  const scope = transientId ? JSON.stringify([threadScope, transientId]) : threadScope
  const runtimeBridge = useRuntimeDictationBridge(request, taskId, scope)
  const runtimeId = snapshot?.runtimeId ?? connection?.runtimeId
  const remote = !!runtimeId && preferences.runtimeDictationIds.includes(runtimeId)
  const bridge = remote ? runtimeBridge : desktopDictationBridge(preferences.dictationProvider)
  const enabled = remote || preferences.dictationEnabled
  const state = useSyncExternalStore(
    dictationSession.subscribe,
    dictationSession.read,
    dictationSession.read,
  )
  const own = state?.scope === scope
  const mounted = useRef<{ scope: string; controller: typeof controller } | undefined>(undefined)
  useEffect(() => {
    mounted.current = { scope, controller }
    return () => {
      mounted.current = undefined
    }
  }, [controller, scope])
  useEffect(() => {
    if (!transientId) return
    return () => {
      if (dictationSession.read()?.scope === scope) void dictationSession.cancel()
    }
  }, [scope, transientId])
  useEffect(() => {
    onActive(!!own && !!state && ['starting', 'recording', 'transcribing'].includes(state.phase))
  }, [own, state?.phase, onActive])
  if (!bridge || !enabled) return null
  const start = () => {
    if (disabled || state || (remote && !snapshot?.runtimeDictationSupported)) return
    const draft = controller.text
    const selection = composerSelection(input.current, draft.length)
    void dictationSession.start({
      scope,
      taskId,
      runtimeId,
      remote,
      transient: transientId ? true : undefined,
      title: workspace.tasks.find((task) => task.id === taskId)?.title ?? 'Thread',
      bridge,
      language: preferences.dictationLanguage,
      capture: recordDictation,
      accept(text) {
        if (
          mounted.current?.scope !== scope ||
          mounted.current.controller !== controller ||
          controller.text !== draft
        )
          return false
        controller.update(insertDictation(draft, text, selection.start, selection.end))
        controller.flush()
        input.current?.focus()
        return true
      },
    })
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      <IconButton
        type="button"
        className="size-7"
        label={
          own && state?.phase === 'recording'
            ? 'Stop dictation'
            : state
              ? 'Dictation in progress'
              : transientId
                ? 'Dictate comment'
                : 'Dictate message'
        }
        disabled={
          disabled ||
          (!!state && !(own && state.phase === 'recording')) ||
          (remote && !snapshot?.runtimeDictationSupported)
        }
        onClick={() =>
          own && state?.phase === 'recording' ? void dictationSession.finish() : start()
        }
      >
        {own && state?.phase === 'recording' ? (
          <Square className="size-3.5 text-status-error" />
        ) : state ? (
          <LoaderCircle className="size-3.5 animate-spin" />
        ) : (
          <Mic className="size-3.5" />
        )}
      </IconButton>
      {transientId && own && state?.preview && <output className="text-sm">{state.preview}</output>}
      {transientId && own && state?.error && (
        <div className="flex items-center gap-2">
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => void dictationSession.cancel()}
          >
            Dismiss
          </Button>
        </div>
      )}
      {own && state?.transcript && (
        <Button
          type="button"
          size="sm"
          disabled={disabled}
          onClick={() => {
            const selection = composerSelection(input.current, controller.text.length)
            controller.update(
              insertDictation(controller.text, state.transcript, selection.start, selection.end),
            )
            controller.flush()
            dictationSession.clear()
            input.current?.focus()
          }}
        >
          Insert transcript
        </Button>
      )}
    </div>
  )
}
