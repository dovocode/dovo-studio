import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { desktopDictationBridge } from '@dovo/protocol'
import { composerRecoveryKey, useAppPreferences, useWorkspace } from '@dovo/studio-core'
import { dictationSession } from '@dovo/studio-core/dictation-session'
import { useRuntimeDictationBridge } from '@dovo/studio-core/runtime-dictation'
import { Button, IconButton } from '@dovo/studio-ui'
import { Mic, Square, LoaderCircle } from 'lucide-react'
import type { createComposerDraft } from './composer-draft'
import { recordDictation, insertDictation } from './dictation-audio'
import { composerSelection } from './composer-input'
import { ConversationVisibilityContext } from '../conversation-visibility'

export function ComposerDictation({
  controller,
  taskId,
  input,
  disabled,
  onActive,
  transientId,
  feedbackTarget,
  hideTrigger = false,
}: {
  taskId: string
  controller: ReturnType<typeof createComposerDraft>
  input: RefObject<HTMLElement | null>
  disabled: boolean
  onActive: (active: boolean) => void
  transientId?: string
  feedbackTarget?: HTMLElement | null
  hideTrigger?: boolean
}) {
  const visible = useContext(ConversationVisibilityContext)
  const { request, connection, snapshot, workspace } = useWorkspace()
  const preferences = useAppPreferences()
  const threadScope = composerRecoveryKey(connection, taskId)
  const scope = transientId ? JSON.stringify([threadScope, transientId]) : threadScope
  const runtimeBridge = useRuntimeDictationBridge(request, taskId, scope)
  const runtimeId = snapshot?.runtimeId ?? connection?.runtimeId
  const remote = !!runtimeId && preferences.runtimeDictationIds.includes(runtimeId)
  const bridge = remote ? runtimeBridge : desktopDictationBridge(preferences.dictationProvider)
  const enabled = remote || preferences.dictationEnabled
  const inline = visible && !!bridge && enabled
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
  useLayoutEffect(() => {
    if (inline && !transientId) return dictationSession.showInComposer(scope)
  }, [inline, scope, transientId])
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
  const feedback = inline && own && (
    <div aria-label="Composer dictation" className="space-y-1 px-3 pt-2 text-xs">
      {state.phase === 'error' ? (
        <p role="alert" className="text-destructive">
          {state.error}
        </p>
      ) : (
        <p role="status" className="text-muted-foreground">
          {state.phase === 'starting'
            ? 'Preparing microphone…'
            : state.phase === 'recording'
              ? 'Recording… Escape cancels.'
              : state.phase === 'transcribing'
                ? 'Transcribing…'
                : 'Review transcript'}
        </p>
      )}
      {(state.transcript || state.preview) && (
        <textarea
          aria-label={state.transcript ? 'Dictation transcript' : 'Live dictation preview'}
          readOnly
          value={state.transcript || state.preview}
          rows={2}
          className="w-full resize-y rounded border bg-background px-2 py-1"
        />
      )}
      <div className="flex flex-wrap gap-2">
        {state.transcript && (
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
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void dictationSession.cancel()}
        >
          {transientId && state.phase === 'error' ? 'Dismiss' : 'Cancel dictation'}
        </Button>
      </div>
    </div>
  )
  return (
    <>
      {(!hideTrigger || own) && (
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
      )}
      {feedbackTarget ? createPortal(feedback, feedbackTarget) : feedback}
    </>
  )
}
