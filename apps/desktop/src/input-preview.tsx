import { useEffect, useRef, useState } from 'react'
import {
  ArrowUpRight,
  LoaderCircle,
  MessageCircleQuestion,
  ShieldCheck,
  X,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { useAppearance } from '@dovo/studio-shell'
import { approvalShortcutKeys, useApprovalShortcuts } from '@dovo/studio-ui/human-input-shortcuts'
import { Button, QuestionForm } from '@dovo/studio-ui'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { ApprovalButtons, ApprovalDetails } from '@dovo/extension-tasks/approval-details'
import {
  approvalActions,
  type ApprovalDecision,
  type InputPreview,
  type InputPreviewBridge,
  type InputPreviewAnswer,
} from '@dovo/protocol'
export function InputPreviewWindow({ bridge }: { bridge: InputPreviewBridge }) {
  useAppearance()
  const uiText = useInterfaceText()
  const [state, setState] = useState<InputPreview | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const answering = useRef(new Set<string>())
  const currentKey = useRef(state?.key)
  currentKey.current = state?.key
  useEffect(() => {
    let active = true
    let updated = false
    const unsubscribe = bridge.subscribe((next) => {
      updated = true
      setState(next)
    })
    void bridge
      .current()
      .then((initial) => {
        if (active && !updated) setState(initial)
      })
      .catch((cause: unknown) => {
        if (active && !updated) setError(String(cause))
      })
    return () => {
      active = false
      unsubscribe()
    }
  }, [bridge])
  useEffect(() => {
    setError('')
    setBusy(false)
  }, [state?.key])
  const answer = async (value: InputPreviewAnswer['answer'], decision?: ApprovalDecision) => {
    if (!state?.connected || answering.current.has(state.key)) return
    const key = state.key
    answering.current.add(key)
    setBusy(true)
    setError('')
    try {
      await bridge.answer({ key: state.key, answer: value, ...(decision ? { decision } : {}) })
    } catch (cause) {
      if (currentKey.current === key)
        setError(cause instanceof Error ? cause.message : String(cause))
      throw cause
    } finally {
      answering.current.delete(key)
      if (currentKey.current === key) setBusy(false)
    }
  }
  const approval = useRef<HTMLElement>(null)
  const actions = state?.request.kind === 'approval' ? approvalActions(state.request.value) : []
  const navigation = (action: 'dismiss' | 'openThread') => {
    if (!state) return
    void bridge[action](state.key).catch((cause: unknown) => {
      if (currentKey.current === state.key)
        setError(cause instanceof Error ? cause.message : String(cause))
    })
  }
  useApprovalShortcuts({
    root: approval,
    disabled: !state?.connected || busy || state.request.kind !== 'approval',
    onAnswer: (_id, allow) => {
      // Y and Enter mean "Allow once". A request without that scope ignores them.
      const decision = allow ? 'approve' : 'deny'
      if (actions.some((action) => action.decision === decision))
        return answer(allow, decision).catch(() => {})
    },
  })
  return (
    <main className="flex h-screen flex-col overflow-hidden rounded-xl border bg-background text-foreground">
      <header className="input-preview-drag flex shrink-0 items-center gap-2.5 border-b bg-card px-4 py-2.5">
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
          aria-hidden="true"
        >
          {state?.request.kind === 'approval' ? (
            <ShieldCheck size={18} />
          ) : (
            <MessageCircleQuestion size={18} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {state?.request.kind === 'approval'
              ? uiText('Permission requested')
              : uiText('Your agent needs an answer')}
          </p>
          <p className="truncate text-xs text-muted-foreground" title={state?.taskTitle}>
            {state?.taskTitle ?? 'Dovo Studio'}
          </p>
        </div>
        {state && state.waiting > 1 && (
          <span className="shrink-0 text-xs text-muted-foreground">
            {uiText('{value0} waiting', { value0: state.waiting })}
          </span>
        )}
        <Button
          aria-label={uiText('Dismiss for now')}
          size="icon"
          variant="ghost"
          disabled={!state}
          onClick={() => navigation('dismiss')}
        >
          <X size={16} />
        </Button>
      </header>
      {state && (
        <>
          <section
            ref={state.request.kind === 'approval' ? approval : undefined}
            key={state.key}
            data-approval-id={
              state.request.kind === 'approval' ? state.request.value.id : undefined
            }
            tabIndex={state.request.kind === 'approval' ? 0 : undefined}
            aria-label={state.request.kind === 'approval' ? state.request.value.title : undefined}
            aria-keyshortcuts={approvalShortcutKeys(actions) || undefined}
            aria-busy={busy}
            className="flex min-h-0 flex-1 flex-col focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
          >
            {state.request.kind === 'question' ? (
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
                <QuestionForm
                  key={state.key}
                  request={state.request.value}
                  connected={state.connected}
                  onAnswer={(answers) => answer(answers)}
                />
              </div>
            ) : (
              <>
                <h2
                  className="mx-4 mt-2.5 shrink-0 truncate text-sm font-semibold"
                  title={state.request.value.title}
                >
                  {state.request.value.title}
                </h2>
                <ApprovalDetails detail={state.request.value.detail} fill />
                <div className="shrink-0 space-y-1.5 border-t bg-muted/20 px-4 py-2">
                  {error && (
                    <p
                      role="alert"
                      className="max-h-10 overflow-y-auto break-words text-xs text-destructive"
                    >
                      {error}
                    </p>
                  )}
                  <ApprovalButtons
                    actions={actions}
                    disabled={!state.connected || busy}
                    onDecision={(decision) =>
                      void answer(decision !== 'deny', decision).catch(() => {})
                    }
                    compact
                  />
                </div>
              </>
            )}
          </section>
          <footer className="flex shrink-0 items-center justify-between gap-2 border-t bg-card px-4 py-1.5">
            <span
              role="status"
              className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
            >
              {busy ? (
                <LoaderCircle size={13} className="shrink-0 animate-spin" />
              ) : state.connected ? (
                <Wifi size={13} className="shrink-0 text-emerald-500" />
              ) : (
                <WifiOff size={13} className="shrink-0" />
              )}
              <span className="truncate" title={state.runtimeName}>
                {busy
                  ? uiText('Sending answer…')
                  : state.connected
                    ? state.runtimeName
                    : uiText('Offline · Reconnecting…')}
              </span>
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="shrink-0"
              onClick={() => navigation('openThread')}
            >
              {uiText('Open thread')}
              <ArrowUpRight size={14} />
            </Button>
          </footer>
        </>
      )}
      {error && state?.request.kind !== 'approval' && (
        <p role="alert" className="shrink-0 px-5 py-3 text-xs text-destructive">
          {error}
        </p>
      )}
    </main>
  )
}
