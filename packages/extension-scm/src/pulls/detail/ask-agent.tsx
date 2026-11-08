import {
  prepareSideThread,
  finishSideThread,
  useSideThreadSource,
} from '@dovo/studio-core/side-thread-creation'
import { useRef, useState } from 'react'
import { Schema } from 'effect'
import {
  buildPullReviewObjective,
  mutableStruct,
  pullLinkedTasks,
  pullTaskResponse,
  randomUUID,
  type PullReviewSelection,
} from '@dovo/protocol'
import { useStudioHost, useWorkspace, type PullDetail } from '@dovo/studio-core'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
  Textarea,
} from '@dovo/studio-ui'
import { integrationMutationError } from '../../connections/mutation-error'

const sideThreadResponse = mutableStruct({ id: Schema.String })

/**
 * Keeps a review selection that still means the same thing in a newer revision. A file that left
 * the PR falls back to the whole PR; changed lines fall back to the whole file.
 */
export function pullSelectionForRevision(
  previous: Pick<PullDetail, 'files'>,
  next: Pick<PullDetail, 'files'>,
  selection: PullReviewSelection | undefined,
): { selection: PullReviewSelection | undefined; note: string } {
  if (!selection?.path) return { selection, note: '' }
  const before = previous.files.find((file) => file.path === selection.path)
  const after = next.files.find((file) => file.path === selection.path)
  if (!after)
    return {
      selection: undefined,
      note: `${selection.path} is not part of the latest revision, so this asks about the whole PR.`,
    }
  if (selection.start === undefined || before?.patch === after.patch) return { selection, note: '' }
  return {
    selection: { path: selection.path },
    note: `${selection.path} changed in the latest revision, so this asks about the whole file instead of the selected lines.`,
  }
}

/**
 * Asks an agent about this PR in a conversation the user chooses explicitly: a full side chat
 * of a thread that links this PR, or a new review task. Nothing is sent until the user reviews
 * the draft and its model in the task.
 */
export function PullAskAgent({
  repositoryId,
  detail: currentDetail,
  selection: initialSelection,
  onClose,
}: {
  repositoryId: string
  detail: PullDetail
  selection?: PullReviewSelection
  onClose: () => void
}) {
  const {
    workspace,
    request,
    connected,
    activeRuntimeId,
    runtimeRegistry,
    switchRuntime,
    connection,
  } = useWorkspace()
  const host = useStudioHost()
  // The computer, account and PR this action was opened for. A change closes the action; it is
  // never rebound to another source silently.
  const scope = JSON.stringify([
    activeRuntimeId,
    connection?.address,
    repositoryId,
    workspace.repositories.find((repo) => repo.id === repositoryId)?.forge,
    currentDetail.destination,
    currentDetail.pull.destination,
    currentDetail.pull.connectionId,
    currentDetail.pull.url,
  ])
  const origin = useRef(scope).current
  const sourceChanged = scope !== origin
  const sourceCurrent = useSideThreadSource(
    JSON.stringify([scope, currentDetail.pull.headSha, currentDetail.pull.baseSha]),
  )
  // The draft refers to the revision that was on screen when the user asked, until they
  // explicitly switch to a newer push of the same PR.
  const [detail, setDetail] = useState(currentDetail)
  const [selection, setSelection] = useState(initialSelection)
  const [revisionNote, setRevisionNote] = useState('')
  const newerRevision =
    !sourceChanged &&
    (currentDetail.pull.headSha !== detail.pull.headSha ||
      currentDetail.pull.baseSha !== detail.pull.baseSha)
  const switchToLatestRevision = () => {
    const next = pullSelectionForRevision(detail, currentDetail, selection)
    setDetail(currentDetail)
    setSelection(next.selection)
    setRevisionNote(next.note)
    setError('')
    attempt.current = undefined
  }
  const [question, setQuestion] = useState(initialSelection?.question ?? '')
  const [parentId, setParentId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const attempt = useRef<{ key: string; id: string } | undefined>(undefined)
  const pending = useRef(false)
  const parents = pullLinkedTasks(workspace.tasks, detail.pull.url).filter(
    (task) =>
      task.repositoryId === repositoryId && !task.sideThread && !task.archivedAt && !task.example,
  )
  const location = selection?.path
    ? `${selection.path}${selection.start ? `:${selection.start}${selection.end && selection.end !== selection.start ? `–${selection.end}` : ''}` : ''}`
    : ''
  const create = async () => {
    if (pending.current || !connected || sourceChanged || newerRevision) return
    pending.current = true
    const current = host.taskNavigationGuard?.() ?? (() => true)
    setBusy(true)
    setError('')
    try {
      const objective = buildPullReviewObjective(detail, { ...selection, question })
      let id: string
      if (parentId) {
        if (!parents.some((task) => task.id === parentId))
          throw new Error('Choose a thread that still links this PR.')
        // A retry after an uncertain response reuses the side chat id.
        const key = JSON.stringify([parentId, objective])
        if (attempt.current?.key !== key) attempt.current = { key, id: randomUUID() }
        const creationScope = JSON.stringify([activeRuntimeId, parentId])
        const childId = prepareSideThread(creationScope, attempt.current.id, objective)
        id = (
          await request(
            '/api/tasks/side-thread/create',
            { id: parentId, childId, objective },
            sideThreadResponse,
          )
        ).id
        finishSideThread(creationScope, childId)
      } else
        id = (
          await request(
            '/api/scm/pulls/task',
            {
              repositoryId,
              number: detail.pull.number,
              headSha: detail.pull.headSha,
              expectedDestination: detail.destination ?? detail.pull.destination,
              connectionId: detail.pull.connectionId,
              objective,
              checkoutMode: 'new-branch',
              run: false,
            },
            pullTaskResponse,
          )
        ).id
      attempt.current = undefined
      if (!current() || !sourceCurrent()) return
      if (activeRuntimeId && activeRuntimeId !== runtimeRegistry.activeId)
        await switchRuntime(activeRuntimeId)
      if (!current() || !sourceCurrent()) return
      onClose()
      // The task opens with this PR beside its full chat.
      host.navigate({
        viewId: 'tasks',
        entityId: id,
        ...(activeRuntimeId
          ? {
              pullTarget: {
                runtimeId: activeRuntimeId,
                repositoryId,
                number: detail.pull.number,
                url: detail.pull.url,
                tab: selection?.path ? ('changes' as const) : ('overview' as const),
                ...(detail.pull.connectionId ? { connectionId: detail.pull.connectionId } : {}),
              },
            }
          : {}),
      })
    } catch (cause) {
      setError(integrationMutationError(cause))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent aria-label="Ask agent about this PR">
        <DialogTitle>Ask agent about this PR</DialogTitle>
        <DialogDescription>
          PR #{detail.pull.number} · {detail.pull.headSha.slice(0, 8)}
          {location ? ` · ${location}` : ''}. The PR and selection become an editable draft; review
          its model and send when ready.
        </DialogDescription>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            void create()
          }}
        >
          <Textarea
            aria-label="Question for the agent"
            placeholder={selection?.path ? 'Explain this change…' : 'Review this PR…'}
            value={question}
            maxLength={4000}
            onChange={(event) => setQuestion(event.target.value)}
            className="min-h-20"
          />
          <fieldset className="space-y-1">
            <legend className="mb-1 text-xs font-medium">Conversation</legend>
            {[
              {
                id: '',
                title: 'New review thread',
                detail: 'A new thread on a branch from this PR',
              },
              ...parents.map((task) => ({
                id: task.id,
                title: task.title,
                detail: 'Side chat of this linked thread, with its own checkout',
              })),
            ].map((option) => (
              <label
                key={option.id || 'new'}
                className="flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm has-[:checked]:border-primary/60 has-[:checked]:bg-muted/50"
              >
                <input
                  type="radio"
                  name="pull-agent-conversation"
                  className="mt-1"
                  checked={parentId === option.id}
                  onChange={() => setParentId(option.id)}
                />
                <span className="min-w-0">
                  <span className="block truncate">{option.title}</span>
                  <span className="block text-xs text-muted-foreground">{option.detail}</span>
                </span>
              </label>
            ))}
            {!parents.length && (
              <p className="text-xs text-muted-foreground">
                Link a thread to this PR to ask in a side chat of it.
              </p>
            )}
          </fieldset>
          {sourceChanged ? (
            <p role="alert" className="text-xs text-destructive">
              The PR source changed. Close and reopen this review action.
            </p>
          ) : (
            newerRevision && (
              <div
                role="alert"
                className="flex flex-wrap items-center gap-2 rounded-md border border-status-warning/40 px-3 py-2 text-xs"
              >
                <span className="min-w-0 flex-1">
                  This PR was updated to {currentDetail.pull.headSha.slice(0, 8)}. Your question is
                  kept; the selection is checked against the latest revision.
                </span>
                <Button type="button" size="sm" variant="outline" onClick={switchToLatestRevision}>
                  Use latest revision
                </Button>
              </div>
            )
          )}
          {revisionNote && !newerRevision && (
            <p role="status" className="text-xs text-muted-foreground">
              {revisionNote}
            </p>
          )}
          {error && (
            <p role="alert" className="text-xs text-destructive [overflow-wrap:anywhere]">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!connected || busy || sourceChanged || newerRevision}>
              {busy ? 'Creating…' : parentId ? 'Create side chat draft' : 'Create review thread'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
