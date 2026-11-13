import { useRef, useState } from 'react'
import {
  RuntimeRequestError,
  decode,
  randomUUID,
  responseActionSendSchema,
  responseActionText,
  responseFormDefaults,
  threadActionResultSchema,
  type ResponseActionSend,
  type Task,
  type ThreadAction,
} from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  FormField,
  Textarea,
} from '@dovo/studio-ui'
import { botScope } from '../../bots/bot-scope'
import { taskActionClient } from '../../list/task-row-actions'

type Draft = {
  text: string
  values?: Record<string, string>
  actionId?: string
  attempt?: ResponseActionSend
  stale?: boolean
}
const drafts = new Map<string, Draft>()

export function ResponseActionCard(props: {
  task: Task
  action: ThreadAction
  onTerminal?: (id: string) => void
}) {
  const store = useWorkspace()
  const scope = JSON.stringify([
    botScope(store.snapshot?.runtimeId ?? store.activeRuntimeId, store.connection),
    props.task.id,
    props.action.id,
  ])
  return <ResponseActionBody key={scope} {...props} scope={scope} />
}

function ResponseActionBody({
  task,
  action,
  onTerminal,
  scope,
}: {
  task: Task
  action: ThreadAction
  onTerminal?: (id: string) => void
  scope: string
}) {
  const store = useWorkspace()
  const [receipt, setReceipt] = useState<ThreadAction>()
  const [draft, setDraft] = useState<Draft>(
    () =>
      drafts.get(scope) ?? {
        text: action.prompt,
        values: action.response ? responseFormDefaults(action.response) : {},
      },
  )
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const current = receipt && receipt.updatedAt >= action.updatedAt ? receipt : action
  const response = current.response
  if (!response || current.state === 'dismissed' || !store.snapshot?.responseActionsSupported)
    return null
  const client = taskActionClient(store, {
    runtimeId: store.activeRuntimeId,
    online: store.connected,
    name: 'Source computer',
  })
  const write = (value: Draft) => {
    drafts.set(scope, value)
    setDraft(value)
  }
  const run = async (work: () => Promise<void>) => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      await work()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  const review = (actionId = draft.actionId) =>
    run(async () => {
      const dispatch =
        response.kind === 'form' ? { actionId, values: draft.values ?? {} } : undefined
      const result = await client.request(
        '/api/thread-actions/review',
        {
          sourceTaskId: task.id,
          actionId: action.id,
          ...(dispatch ? { dispatch } : {}),
        },
        threadActionResultSchema,
      )
      setReceipt(result.action)
      if (!draft.attempt)
        write({
          ...draft,
          actionId,
          stale: false,
          text:
            result.action.responseReview?.resolved.kind === 'prompt'
              ? draft.actionId === actionId && !draft.stale
                ? draft.text
                : result.action.responseReview.resolved.prompt
              : draft.text,
        })
      setEditing(result.action.state === 'prepared')
    })
  const send = () =>
    run(async () => {
      const attempt =
        draft.attempt ??
        decode(responseActionSendSchema, {
          sourceTaskId: task.id,
          actionId: action.id,
          response: true,
          revision: current.responseReview?.revision ?? '',
          messageId: randomUUID(),
          ...(current.responseReview?.resolved.kind === 'prompt' ? { text: draft.text } : {}),
        })
      write({ ...draft, attempt })
      let result
      try {
        result = await client.request('/api/thread-actions/send', attempt, threadActionResultSchema)
      } catch (cause) {
        if (cause instanceof RuntimeRequestError && cause.mutationRejected)
          write({ ...draft, attempt: undefined, stale: true })
        throw cause
      }
      setReceipt(result.action)
      drafts.delete(scope)
      setDraft({ text: draft.text })
      setEditing(false)
      try {
        await client.refresh()
      } catch (cause) {
        setError(
          `Saved. Refresh pending: ${cause instanceof Error ? cause.message : String(cause)}`,
        )
      }
    })
  const operation = response.kind === 'form' ? current.responseReview?.resolved : response
  const prompt = operation?.kind === 'prompt'
  const frozen = !!draft.attempt
  const reviewed = !!current.responseReview && !draft.stale
  const result = current.responseResult
  return (
    <section
      aria-label={`Response action: ${current.title}`}
      data-thread-action={action.id}
      data-studio-human-only="true"
      className="my-3 grid min-w-0 gap-3 rounded-xl border bg-card p-4 text-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">{current.title}</h3>
        <span className="text-xs text-muted-foreground">
          {response.kind === 'prompt'
            ? 'This thread'
            : response.kind === 'form'
              ? 'Custom form'
              : response.kind === 'command'
                ? 'Command'
                : `MCP · ${response.server} · ${response.tool}`}
        </span>
      </div>
      <p className="line-clamp-3 whitespace-pre-wrap break-words text-muted-foreground">
        {responseActionText(response)}
      </p>
      {current.state === 'sent' ? (
        <>
          <p role="status">
            {result?.status === 'running'
              ? 'Running…'
              : prompt
                ? 'Sent to this thread'
                : (result?.status ?? 'Accepted')}
          </p>
          {result?.output && (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">
              {result.output}
            </pre>
          )}
          {result?.terminalId && onTerminal && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (result.terminalId) onTerminal(result.terminalId)
              }}
            >
              Open terminal
            </Button>
          )}
          {result?.status === 'running' && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !store.connected}
              onClick={() => void review()}
            >
              Refresh result
            </Button>
          )}
        </>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={busy || !store.connected}
            onClick={() => {
              if (frozen || response.kind === 'form') setEditing(true)
              else void review()
            }}
          >
            {response.kind === 'form' ? 'Open form' : prompt ? 'Review prompt' : 'Review action'}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy || !store.connected || frozen}
            onClick={() =>
              void run(async () => {
                const result = await client.request(
                  '/api/thread-actions/dismiss',
                  { sourceTaskId: task.id, actionId: action.id },
                  threadActionResultSchema,
                )
                setReceipt(result.action)
                drafts.delete(scope)
              })
            }
          >
            Dismiss
          </Button>
        </div>
      )}
      {error && !editing && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {editing && current.state === 'prepared' && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !busy) setEditing(false)
          }}
        >
          <DialogContent
            className="max-h-[85dvh] overflow-y-auto sm:max-w-xl"
            data-studio-human-only="true"
          >
            <DialogHeader>
              <DialogTitle>{current.title}</DialogTitle>
              <DialogDescription>
                {current.responseReview?.description ?? 'Review this action before sending.'}
              </DialogDescription>
            </DialogHeader>
            <div className="grid min-w-0 gap-4">
              {response.kind === 'form' && (
                <>
                  <p className="text-sm text-muted-foreground">{response.description}</p>
                  {response.fields.map((field) => (
                    <FormField key={field.id} label={field.label + (field.required ? ' *' : '')}>
                      {field.type === 'choice' ? (
                        <select
                          aria-label={field.label}
                          className="rounded-md border bg-background p-2 text-sm"
                          value={draft.values?.[field.id] ?? ''}
                          disabled={busy || frozen}
                          onChange={(event) =>
                            write({
                              ...draft,
                              values: { ...draft.values, [field.id]: event.target.value },
                              stale: true,
                            })
                          }
                        >
                          <option value="">Choose…</option>
                          {field.options?.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <Textarea
                          aria-label={field.label}
                          rows={field.type === 'multiline' ? 4 : 1}
                          maxLength={4000}
                          value={draft.values?.[field.id] ?? ''}
                          disabled={busy || frozen}
                          onChange={(event) =>
                            write({
                              ...draft,
                              values: { ...draft.values, [field.id]: event.target.value },
                              stale: true,
                            })
                          }
                        />
                      )}
                    </FormField>
                  ))}
                  <div className="flex flex-wrap gap-2">
                    {response.actions.map((item) => (
                      <Button
                        key={item.id}
                        variant="outline"
                        disabled={busy || frozen || !store.connected}
                        onClick={() => void review(item.id)}
                      >
                        Review {item.title}
                      </Button>
                    ))}
                  </div>
                </>
              )}
              {operation && (
                <>
                  <p className="text-sm">
                    {prompt ? 'Destination: this thread' : 'Runs on this thread’s computer'}
                  </p>
                  {current.responseReview?.directory && (
                    <p className="break-all text-xs text-muted-foreground">
                      Directory: {current.responseReview.directory}
                    </p>
                  )}
                  {prompt ? (
                    <FormField label="Prompt">
                      <Textarea
                        aria-label="Response prompt"
                        value={draft.text}
                        maxLength={20000}
                        disabled={busy || frozen}
                        onChange={(event) => write({ ...draft, text: event.target.value })}
                      />
                    </FormField>
                  ) : (
                    <pre
                      aria-label="Exact action"
                      className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg border p-3 text-xs"
                    >
                      {responseActionText(operation)}
                    </pre>
                  )}
                </>
              )}
              {operation && !prompt && (
                <p className="text-xs text-muted-foreground">
                  Run executes this exact action once. Commands use a new terminal. MCP results stay
                  on this card.
                </p>
              )}
              {frozen && (
                <p role="status">
                  The request may have reached the computer. Retry checks the same receipt and will
                  not run a direct action twice.
                </p>
              )}
              {draft.stale && (
                <p role="status">Refresh the review before running. Your prompt stays.</p>
              )}
              {error && (
                <p role="alert" className="text-destructive">
                  {error}
                </p>
              )}
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="ghost" disabled={busy} onClick={() => setEditing(false)}>
                  Close
                </Button>
                {!frozen && (response.kind !== 'form' || !!draft.actionId) && (
                  <Button
                    variant="outline"
                    disabled={busy || !store.connected}
                    onClick={() => void review()}
                  >
                    Refresh review
                  </Button>
                )}
                <Button
                  disabled={
                    busy ||
                    !store.connected ||
                    (!frozen && (!reviewed || (prompt && !draft.text.trim())))
                  }
                  onClick={() => void send()}
                >
                  {busy ? 'Sending…' : frozen ? 'Retry' : prompt ? 'Send to thread' : 'Run action'}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </section>
  )
}
