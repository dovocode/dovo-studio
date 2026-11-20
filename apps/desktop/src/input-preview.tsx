import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, MessageCircleQuestion, ShieldCheck, X, Wifi, WifiOff } from 'lucide-react'
import { useAppearance } from '@dovo/studio-shell'
import { approvalShortcutKeys, useApprovalShortcuts } from '@dovo/studio-ui/human-input-shortcuts'
import { Button, QuestionForm } from '@dovo/studio-ui'
import { ApprovalDetails } from '@dovo/extension-tasks/approval-details'
import {
  approvalActions,
  type ApprovalDecision,
  type InputPreview,
  type InputPreviewBridge,
  type InputPreviewAnswer,
} from '@dovo/protocol'
export function InputPreviewWindow({ bridge }: { bridge: InputPreviewBridge }) {
  useAppearance()
  const [state, setState] = useState<InputPreview | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const currentKey = useRef(state?.key)
  currentKey.current = state?.key
  useEffect(() => {
    const unsubscribe = bridge.subscribe(setState)
    void bridge
      .current()
      .then(setState)
      .catch((cause: unknown) => setError(String(cause)))
    return unsubscribe
  }, [bridge])
  useEffect(() => {
    setError('')
    setBusy(false)
  }, [state?.key])
  const answer = async (value: InputPreviewAnswer['answer'], decision?: ApprovalDecision) => {
    if (!state || busy) return
    const key = state.key
    setBusy(true)
    setError('')
    try {
      await bridge.answer({ key: state.key, answer: value, ...(decision ? { decision } : {}) })
    } catch (cause) {
      if (currentKey.current === key)
        setError(cause instanceof Error ? cause.message : String(cause))
      throw cause
    } finally {
      if (currentKey.current === key) setBusy(false)
    }
  }
  const approval = useRef<HTMLElement>(null)
  const actions = state?.request.kind === 'approval' ? approvalActions(state.request.value) : []
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
      <header className="input-preview-drag flex shrink-0 items-center gap-3 border-b bg-card px-5 py-4">
        <span className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
          {state?.request.kind === 'approval' ? (
            <ShieldCheck size={18} />
          ) : (
            <MessageCircleQuestion size={18} />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {state?.request.kind === 'approval'
              ? 'Permission requested'
              : 'Your agent needs an answer'}
          </p>
          <p className="text-xs text-muted-foreground">
            Dovo Studio{state && state.waiting > 1 ? ` · ${state.waiting} waiting` : ''}
          </p>
        </div>
        <Button
          aria-label="Dismiss for now"
          size="icon"
          variant="ghost"
          onClick={() => void bridge.dismiss()}
        >
          <X size={16} />
        </Button>
      </header>
      {state && (
        <>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
            <div className="space-y-1">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Thread
              </p>
              <p className="break-words text-sm font-medium leading-relaxed">{state.taskTitle}</p>
            </div>
            {!state.connected && (
              <p
                role="status"
                className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-muted-foreground"
              >
                Reconnecting to server… Answers are disabled until connected.
              </p>
            )}
            {state.request.kind === 'question' ? (
              <QuestionForm
                key={state.key}
                request={state.request.value}
                connected={state.connected}
                onAnswer={(answers) => answer(answers)}
              />
            ) : (
              <section
                ref={approval}
                key={state.key}
                data-approval-id={state.request.value.id}
                tabIndex={0}
                aria-keyshortcuts={approvalShortcutKeys(actions)}
                className="space-y-4 rounded-xl border bg-card p-4"
              >
                <h2 className="text-sm font-medium">{state.request.value.title}</h2>
                <ApprovalDetails detail={state.request.value.detail} />
                <div className="flex flex-wrap gap-2">
                  {actions.map((action) => (
                    <Button
                      key={action.decision}
                      className="flex-1"
                      variant={action.decision === 'approve' ? 'default' : 'outline'}
                      disabled={!state.connected || busy}
                      onClick={() =>
                        void answer(action.decision !== 'deny', action.decision).catch(() => {})
                      }
                    >
                      {action.label}
                      {(action.decision === 'approve' || action.decision === 'deny') && (
                        <kbd aria-hidden="true" className="ml-1 text-[0.625rem]">
                          {action.decision === 'approve' ? 'Y / Enter' : 'N'}
                        </kbd>
                      )}
                    </Button>
                  ))}
                </div>
              </section>
            )}
          </div>
          <footer className="flex shrink-0 items-center justify-between gap-3 border-t bg-card px-5 py-3">
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              {state.connected ? (
                <Wifi size={13} className="shrink-0 text-emerald-500" />
              ) : (
                <WifiOff size={13} className="shrink-0" />
              )}
              <span className="truncate">{state.runtimeName}</span>
            </span>
            <Button size="sm" variant="ghost" onClick={() => void bridge.openThread()}>
              Open thread
              <ArrowUpRight size={14} />
            </Button>
          </footer>
        </>
      )}
      {error && (
        <p role="alert" className="shrink-0 px-5 py-3 text-xs text-destructive">
          {error}
        </p>
      )}
    </main>
  )
}
