import { useState, useRef } from 'react'
import { Pencil } from 'lucide-react'
import { workspacePatchResultSchema, type Task } from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { Button, Input } from '@dovo/studio-ui'
/** Save on the child's owning computer. Keep the draft if the write fails. */
type Props = {
  child: Pick<Task, 'id' | 'title'>
  runtimeId: string | null
  runtimeIdentity?: string
}
export function ChildThreadName(props: Props) {
  const store = useWorkspace()
  return (
    <ChildThreadNameEditor
      key={JSON.stringify([
        store.activeRuntimeId,
        store.connection,
        props.runtimeId,
        props.runtimeIdentity,
        props.child.id,
      ])}
      {...props}
    />
  )
}
function ChildThreadNameEditor({
  child,
  runtimeId,
  runtimeIdentity,
}: {
  child: Pick<Task, 'id' | 'title'>
  runtimeId: string | null
  runtimeIdentity?: string
}) {
  const uiText = useInterfaceText()
  const store = useWorkspace()
  const pending = useRef(false)
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(child.title)
  const [before, setBefore] = useState(child.title)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const local = runtimeId === store.activeRuntimeId
  const source = store.runtimes?.find((entry) => entry.profile.id === runtimeId)
  const online = local ? store.connected : !!source?.connected
  const identity = local ? store.snapshot?.runtimeId : source?.snapshot?.runtimeId
  const available = online && (!runtimeIdentity || identity === runtimeIdentity)
  return editing ? (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (!available || pending.current || !title.trim()) return
        pending.current = true
        setBusy(true)
        setError('')
        const input = {
          collection: 'tasks',
          id: child.id,
          changes: { title: { before, after: title.trim() } },
        }
        const save = local
          ? store.request('/api/workspace', input, workspacePatchResultSchema, 'PATCH')
          : source
            ? store.readRuntime(
                source.profile,
                '/api/workspace',
                input,
                workspacePatchResultSchema,
                'PATCH',
              )
            : Promise.reject(new Error('This computer is unavailable.'))
        void save
          .then(async (result) => {
            if (
              result.outcome === 'rejected' ||
              result.outcome === 'reconciled' ||
              result.reconciled
            )
              throw new Error(
                result.reason ?? 'The thread name changed. Reopen Rename thread and try again.',
              )
            setEditing(false)
            if (source) {
              try {
                await store.refreshRuntime(source.profile)
              } catch {
                /* The name is saved; runtime refresh exposes its own connection error. */
              }
            }
          })
          .catch((cause: unknown) =>
            setError(cause instanceof Error ? cause.message : String(cause)),
          )
          .finally(() => {
            pending.current = false
            setBusy(false)
          })
      }}
    >
      <Input
        aria-label={uiText('Thread title')}
        autoFocus
        value={title}
        disabled={busy}
        onChange={(event) => setTitle(event.target.value)}
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy || !available || !title.trim()}>
          {uiText('Save title')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => setEditing(false)}
        >
          {uiText('Cancel')}
        </Button>
      </div>
      {!!error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </form>
  ) : (
    <Button
      size="sm"
      variant="ghost"
      disabled={!available}
      aria-label={uiText('Rename {value0}', { value0: child.title })}
      onClick={() => {
        setTitle(child.title)
        setBefore(child.title)
        setError('')
        setEditing(true)
      }}
    >
      <Pencil className="size-3" />
      {uiText('Rename thread')}
    </Button>
  )
}
