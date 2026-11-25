import { useEffect, useSyncExternalStore } from 'react'
import { useAppPreferences, useStudioHost } from '@dovo/studio-core'
import { dictationSession } from '@dovo/studio-core/dictation-session'
import { Button } from '@dovo/studio-ui'
export function DictationNotice() {
  const session = useSyncExternalStore(
    dictationSession.subscribe,
    dictationSession.read,
    dictationSession.read,
  )
  const host = useStudioHost()
  const preferences = useAppPreferences()
  useEffect(() => {
    if (session && !session.remote && !preferences.dictationEnabled) void dictationSession.cancel()
  }, [!!session, session?.remote, preferences.dictationEnabled])
  useEffect(() => {
    if (!session || session.transient) return
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        void dictationSession.cancel()
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [!!session, session?.transient])
  if (!session || session.transient) return null
  return (
    <aside
      aria-label="Dictation"
      className="fixed bottom-4 right-4 z-50 w-80 space-y-2 rounded-lg border bg-popover p-3 text-xs text-popover-foreground shadow-lg"
    >
      <p className="font-medium">Dictation · {session.title}</p>
      <p role="status" aria-live="polite">
        {session.phase === 'starting'
          ? 'Loading speech model and opening microphone…'
          : session.phase === 'recording'
            ? 'Recording… Maximum 5 minutes. Escape cancels.'
            : session.phase === 'transcribing'
              ? 'Transcribing on the selected computer…'
              : 'Recording stopped.'}
      </p>
      {session.error && <p role="alert">{session.error}</p>}
      {(session.transcript || session.preview) && (
        <textarea
          aria-label={session.transcript ? 'Dictation transcript' : 'Live dictation preview'}
          readOnly
          value={session.transcript || session.preview}
          className="max-h-40 w-full rounded border bg-background p-2"
        />
      )}
      <div className="flex flex-wrap gap-2">
        {session.phase === 'recording' && (
          <Button size="sm" onClick={() => void dictationSession.finish()}>
            Stop dictation
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            host.navigate({
              viewId: 'tasks',
              entityId: session.taskId,
              threadConnection: {
                runtimeId: session.runtimeId ?? null,
                threadId: session.taskId,
                title: session.title,
              },
            })
          }
        >
          Return to thread
        </Button>
        <Button size="sm" variant="outline" onClick={() => void dictationSession.cancel()}>
          Cancel dictation
        </Button>
      </div>
    </aside>
  )
}
