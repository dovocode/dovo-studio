import { useEffect, useRef, useState } from 'react'
import {
  RuntimeRequestError,
  decode,
  taskHarnessSchema,
  resolveScopedAgents,
  type TaskHarness,
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
  HarnessFields,
  Textarea,
  permissionPolicyUIIssue,
} from '@dovo/studio-ui'

export type ThreadActionSelection = {
  prompt: string
  harness: TaskHarness
  agentId?: string
  repositoryId: string
}
type Draft = ThreadActionSelection & { attempt?: ThreadActionSelection }
const drafts = new Map<string, Draft>()

/** The caller owns dispatch identity. Opening this editor never starts work. */
export function ThreadActionEditor({
  draftKey,
  initial,
  onSend,
  onClose,
}: {
  draftKey: string
  initial: ThreadActionSelection
  onSend: (selection: ThreadActionSelection) => Promise<void>
  onClose: () => void
}) {
  const { connected, snapshot, workspace } = useWorkspace()
  const [draft, setDraft] = useState<Draft>(() => drafts.get(draftKey) ?? initial)
  const repository = workspace.repositories.find((item) => item.id === draft.repositoryId)
  const agents = resolveScopedAgents(snapshot?.defaults, repository, workspace.agents)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const mounted = useRef(false)
  const generation = useRef(0)
  useEffect(() => {
    mounted.current = true
    generation.current++
    return () => {
      mounted.current = false
      generation.current++
    }
  }, [draftKey])
  const change = (next: Draft) => {
    drafts.set(draftKey, next)
    setDraft(next)
  }
  const issue = permissionPolicyUIIssue(draft.harness, snapshot?.permissionPolicySupported === true)
  const send = async () => {
    if (lock.current || !connected || issue || !repository || !draft.prompt.trim()) return
    lock.current = true
    setBusy(true)
    setError('')
    const attempt = draft.attempt ?? {
      prompt: draft.prompt.trim(),
      harness: draft.harness,
      agentId: draft.agentId,
      repositoryId: draft.repositoryId,
    }
    const submitted = { ...draft, attempt }
    const operation = generation.current
    const isCurrent = () =>
      mounted.current && generation.current === operation && drafts.get(draftKey) === submitted
    change(submitted)
    try {
      await onSend(attempt)
      if (isCurrent()) {
        drafts.delete(draftKey)
        onClose()
      }
    } catch (cause) {
      if (!isCurrent()) return
      if (cause instanceof RuntimeRequestError && cause.mutationRejected)
        change({ ...draft, attempt: undefined })
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      lock.current = false
      if (mounted.current && generation.current === operation) setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New agent thread</DialogTitle>
          <DialogDescription>
            Review the prompt, harness and model before Send. Preparation starts no work.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault()
            void send()
          }}
        >
          <fieldset className="grid min-w-0 gap-3" disabled={busy || !!draft.attempt}>
            <FormField label="Destination">
              <select
                aria-label="New thread project"
                className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                value={draft.repositoryId}
                onChange={(event) =>
                  change({ ...draft, repositoryId: event.target.value, agentId: undefined })
                }
              >
                {!repository && (
                  <option value={draft.repositoryId} disabled>
                    Unavailable project
                  </option>
                )}
                {workspace.repositories.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.kind === 'scratch' ? 'No project' : item.name}
                  </option>
                ))}
              </select>
            </FormField>
            <FormField label="Prompt">
              <Textarea
                aria-label="New thread prompt"
                value={draft.prompt}
                maxLength={120000}
                required
                onChange={(event) => change({ ...draft, prompt: event.target.value })}
              />
            </FormField>
            <HarnessFields
              value={draft.harness}
              agents={agents}
              selectedAgentId={draft.agentId}
              onSelectAgent={(agentId) => {
                const agent = agents.find((item) => item.id === agentId)
                if (agent) change({ ...draft, agentId, harness: decode(taskHarnessSchema, agent) })
              }}
              onChange={(harness) => change({ ...draft, agentId: undefined, harness })}
            />
          </fieldset>
          {!connected && <p role="status">Reconnect the source computer before sending.</p>}
          {issue && (
            <p role="alert" className="text-sm text-destructive">
              {issue}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {draft.attempt && (
            <p role="status" className="text-xs text-muted-foreground">
              Retry sends the same prompt and settings to recover the same thread after a lost
              reply.
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
              Close
            </Button>
            <Button
              type="submit"
              disabled={busy || !connected || !!issue || !repository || !draft.prompt.trim()}
            >
              {busy ? 'Sending…' : draft.attempt ? 'Retry Send' : 'Send'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
