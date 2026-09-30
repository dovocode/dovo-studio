import { useEffect, useState } from 'react'
import { useAppPreferences } from '@dovo/studio-core'
import { Button, QuestionForm } from '@dovo/studio-ui'
import type { InputPreview, InputPreviewBridge, InputPreviewAnswer } from '@dovo/protocol'
export function InputPreviewWindow({ bridge }: { bridge: InputPreviewBridge }) {
  const { theme } = useAppPreferences()
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: light)')
    const apply = () => {
      document.documentElement.dataset.theme =
        theme === 'system' ? (media.matches ? 'light' : 'dark') : theme
    }
    apply()
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])
  const [state, setState] = useState<InputPreview | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
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
  const answer = async (value: InputPreviewAnswer['answer']) => {
    if (!state || busy) return
    setBusy(true)
    setError('')
    try {
      await bridge.answer({ key: state.key, answer: value })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      throw cause
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="flex h-screen flex-col gap-3 overflow-auto bg-background p-4 text-foreground">
      <header className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Dovo · Needs your input</span>
        <Button size="sm" variant="ghost" onClick={() => void bridge.dismiss()}>
          Later
        </Button>
      </header>
      {state && (
        <>
          <div>
            <p className="truncate text-sm font-medium">{state.taskTitle}</p>
            <p className="text-xs text-muted-foreground">
              {state.runtimeName} · {state.waiting} waiting
            </p>
          </div>
          {!state.connected && (
            <p role="status" className="text-xs text-muted-foreground">
              Reconnecting to server… Answers are disabled until connected.
            </p>
          )}
          {state.request.kind === 'question' ? (
            <QuestionForm
              key={state.key}
              request={state.request.value}
              connected={state.connected}
              onAnswer={answer}
            />
          ) : (
            <section key={state.key} className="space-y-3 rounded-lg border p-3">
              <h2 className="text-sm font-medium">{state.request.value.title}</h2>
              <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words text-xs">
                {state.request.value.detail}
              </pre>
              <div className="flex gap-2">
                <Button
                  disabled={!state.connected || busy}
                  onClick={() => void answer(true).catch(() => {})}
                >
                  Allow once
                </Button>
                <Button
                  variant="outline"
                  disabled={!state.connected || busy}
                  onClick={() => void answer(false).catch(() => {})}
                >
                  Deny
                </Button>
              </div>
            </section>
          )}
          <Button variant="outline" onClick={() => void bridge.openThread()}>
            Open thread in Dovo
          </Button>
        </>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </main>
  )
}
