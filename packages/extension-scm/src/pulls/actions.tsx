import { useApplicationState } from '@dovo/studio-core/state'
import { MoreHorizontal } from 'lucide-react'
import { useRef } from 'react'
import {
  forgeLabels,
  pullActionResultSchema,
  useWorkspace,
  type PullAction,
  type PullComment,
  type PullDetail,
} from '@dovo/studio-core'
import {
  Button,
  Checkbox,
  ChoicePicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  FormField,
  Input,
  Textarea,
} from '@dovo/studio-ui'
export type PullActionContext = {
  repositoryId: string
  detail: PullDetail
  onDone: () => void
}
type ActionKind = PullAction['action']
const titles: Record<ActionKind, string> = {
  comment: 'Comment on PR',
  review: 'Submit review',
  reply: 'Reply to comment',
  resolve: 'Update thread',
  edit: 'Edit pull request',
  reviewers: 'Manage reviewers',
  merge: 'Merge pull request',
  close: 'Close pull request',
  reopen: 'Reopen pull request',
}
export function PullActions(
  props: PullActionContext & {
    onStartTask?: () => void
  },
) {
  const { connected } = useWorkspace()
  const [action, setAction] = useApplicationState<ActionKind | null>(null)
  const [notice, setNotice] = useApplicationState('')
  const supported = props.detail.capabilities?.actions ?? []
  const items: ActionKind[] = ['comment', 'review', 'edit', 'reviewers', 'merge', 'close', 'reopen']
  const available = items.filter(
    (item) =>
      supported.includes(item) &&
      (item !== 'merge' ||
        (props.detail.pull.state === 'open' &&
          !props.detail.pull.draft &&
          !!props.detail.capabilities?.mergeMethods.length)) &&
      (item !== 'close' || props.detail.pull.state === 'open') &&
      (item !== 'reopen' || props.detail.pull.state === 'closed') &&
      (item !== 'review' || props.detail.pull.state === 'open'),
  )
  if (!available.length && !props.onStartTask) return null
  return (
    <>
      {available.includes('review') && (
        <Button
          size="sm"
          disabled={!connected}
          onClick={() => {
            setNotice('')
            setAction('review')
          }}
        >
          Review
        </Button>
      )}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="size-8"
            aria-label="PR actions"
            disabled={!connected}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={6}
            className="z-50 min-w-48 rounded-lg border bg-popover p-1 shadow-xl"
          >
            {available
              .filter((item) => item !== 'review')
              .map((item) => (
                <DropdownMenu.Item
                  key={item}
                  onSelect={() => {
                    setNotice('')
                    setAction(item)
                  }}
                  className="cursor-default rounded px-3 py-2 text-xs outline-none data-[highlighted]:bg-accent"
                >
                  {titles[item]}
                </DropdownMenu.Item>
              ))}
            {props.onStartTask && (
              <>
                <DropdownMenu.Separator className="my-1 h-px bg-border" />
                <DropdownMenu.Item
                  className="cursor-default rounded px-3 py-2 text-xs outline-none data-[highlighted]:bg-accent"
                  onSelect={props.onStartTask}
                >
                  Start task from PR
                </DropdownMenu.Item>
              </>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
      {notice && (
        <span role="status" className="max-w-56 text-xs text-muted-foreground">
          {notice}
        </span>
      )}
      {action && (
        <PullActionDialog
          {...props}
          kind={action}
          onClose={() => setAction(null)}
          onCompleted={(message) => {
            setNotice(message)
            props.onDone()
          }}
        />
      )}
    </>
  )
}
export function PullCommentActions({
  comment,
  ...context
}: PullActionContext & {
  comment: PullComment
}) {
  const { connected } = useWorkspace()
  const [action, setAction] = useApplicationState<'reply' | 'resolve' | null>(null)
  const supported = context.detail.capabilities?.actions ?? []
  const reply =
    supported.includes('reply') &&
    comment.kind !== 'review' &&
    (context.detail.pull.provider !== 'github' || comment.kind === 'inline')
  const resolve =
    supported.includes('resolve') && comment.threadId && comment.canResolve && !comment.replyTo
  if (!reply && !resolve) return null
  return (
    <div className="flex flex-wrap gap-2 border-t px-4 py-2">
      {reply && (
        <Button size="sm" variant="ghost" disabled={!connected} onClick={() => setAction('reply')}>
          Reply
        </Button>
      )}
      {resolve && (
        <Button
          size="sm"
          variant="ghost"
          disabled={!connected}
          onClick={() => setAction('resolve')}
        >
          {comment.resolved ? 'Reopen thread' : 'Resolve thread'}
        </Button>
      )}
      {action && (
        <PullActionDialog
          {...context}
          kind={action}
          comment={comment}
          onClose={() => setAction(null)}
          onCompleted={context.onDone}
        />
      )}
    </div>
  )
}
function PullActionDialog({
  repositoryId,
  detail,
  kind,
  comment,
  onClose,
  onCompleted,
}: PullActionContext & {
  kind: ActionKind
  comment?: PullComment
  onClose: () => void
  onCompleted: (message: string) => void
}) {
  const { request, connected } = useWorkspace()
  const [body, setBody] = useApplicationState(kind === 'edit' ? detail.pull.body : '')
  const [title, setTitle] = useApplicationState(detail.pull.title)
  const [base, setBase] = useApplicationState(
    detail.pull.base
      .replace(/^refs\/heads\//, '')
      .split(':')
      .at(-1) ?? '',
  )
  const [event, setEvent] = useApplicationState<'comment' | 'approve' | 'request-changes'>(
    detail.capabilities?.reviewDecisions[0] ?? 'comment',
  )
  const [initialBase] = useApplicationState(base)
  const [method, setMethod] = useApplicationState<'merge' | 'squash' | 'rebase'>(
    detail.capabilities?.mergeMethods[0] ?? 'merge',
  )
  const [reviewers, setReviewers] = useApplicationState('')
  const [teams, setTeams] = useApplicationState('')
  const [operation, setOperation] = useApplicationState<'add' | 'remove'>('add')
  const [confirmed, setConfirmed] = useApplicationState(false)
  const [busy, setBusy] = useApplicationState(false)
  const pending = useRef(false)
  const [error, setError] = useApplicationState('')
  // Keep the revision the form opened against. Background refreshes must not
  // silently move a user's review or merge confirmation onto a different head.
  const [scope] = useApplicationState({
    number: detail.pull.number,
    headSha: detail.pull.headSha,
  })
  const provider = forgeLabels[detail.pull.provider ?? 'github']
  const list = (value: string) => [...new Set(value.split(/[\s,]+/).filter(Boolean))]
  const payload = (): PullAction => {
    switch (kind) {
      case 'comment':
        return {
          ...scope,
          action: kind,
          body,
        }
      case 'review':
        return {
          ...scope,
          action: kind,
          body,
          event,
        }
      case 'reply':
        return {
          ...scope,
          action: kind,
          body,
          commentId: comment?.id ?? '',
          ...(comment?.threadId
            ? {
                threadId: comment.threadId,
              }
            : {}),
        }
      case 'resolve':
        return {
          ...scope,
          action: kind,
          threadId: comment?.threadId ?? '',
          resolved: !comment?.resolved,
        }
      case 'edit':
        return {
          ...scope,
          action: kind,
          title,
          body,
          ...(base.trim() && base.trim() !== initialBase
            ? {
                base: base.trim(),
              }
            : {}),
        }
      case 'reviewers':
        return {
          ...scope,
          action: kind,
          operation,
          reviewers: list(reviewers),
          teams: list(teams),
        }
      case 'merge':
        return {
          ...scope,
          action: kind,
          method,
          ...(body.trim()
            ? {
                message: body,
              }
            : {}),
        }
      case 'close':
      case 'reopen':
        return {
          ...scope,
          action: kind,
        }
    }
  }
  const needsBody =
    kind === 'comment' || kind === 'reply' || (kind === 'review' && event !== 'approve')
  const valid =
    (!needsBody || !!body.trim()) &&
    (kind !== 'edit' || !!title.trim()) &&
    (kind !== 'merge' || confirmed) &&
    (kind !== 'reviewers' || !!(list(reviewers).length + list(teams).length))
  const submit = async () => {
    if (!valid || !connected || pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      const result = await request(
        '/api/scm/pulls/action',
        {
          repositoryId,
          ...payload(),
        },
        pullActionResultSchema,
      )
      onCompleted(
        result.message ||
          (result.status === 'merged'
            ? 'Pull request merged.'
            : result.status === 'queued'
              ? 'Merge queued.'
              : 'Pull request updated.'),
      )
      onClose()
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  const label =
    kind === 'resolve' ? (comment?.resolved ? 'Reopen thread' : 'Resolve thread') : titles[kind]
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending.current) onClose()
      }}
    >
      <DialogContent
        className="max-h-[85vh] overflow-y-auto"
        onEscapeKeyDown={(e) => {
          if (busy) e.preventDefault()
        }}
        onPointerDownOutside={(e) => {
          if (busy) e.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>
            {provider} · #{scope.number} · commit {scope.headSha.slice(0, 8)}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          {kind === 'edit' && (
            <>
              <FormField label="Title">
                <Input
                  aria-label="PR title"
                  value={title}
                  disabled={busy}
                  maxLength={300}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </FormField>
              <FormField label="Base branch">
                <Input
                  aria-label="PR base branch"
                  value={base}
                  disabled={busy}
                  onChange={(e) => setBase(e.target.value)}
                />
              </FormField>
            </>
          )}
          {kind === 'review' && (
            <FormField label="Review decision">
              <ChoicePicker
                aria-label="Review decision"
                disabled={busy}
                value={event}
                onValueChange={(value) => {
                  if (value === 'comment' || value === 'approve' || value === 'request-changes')
                    setEvent(value)
                }}
              >
                {detail.capabilities?.reviewDecisions.map((value) => (
                  <option key={value} value={value}>
                    {value === 'approve'
                      ? 'Approve'
                      : value === 'request-changes'
                        ? 'Request changes'
                        : 'Comment'}
                  </option>
                ))}
              </ChoicePicker>
            </FormField>
          )}
          {kind === 'reviewers' && (
            <>
              <FormField label="Reviewer action">
                <ChoicePicker
                  aria-label="Reviewer action"
                  value={operation}
                  disabled={busy}
                  onValueChange={(value) => {
                    if (value === 'add' || value === 'remove') setOperation(value)
                  }}
                >
                  <option value="add">Request review</option>
                  <option value="remove">Remove review request</option>
                </ChoicePicker>
              </FormField>
              <FormField label="Reviewers">
                <Input
                  aria-label="Reviewers"
                  placeholder="Usernames separated by commas"
                  value={reviewers}
                  disabled={busy}
                  onChange={(e) => setReviewers(e.target.value)}
                />
              </FormField>
              {(detail.pull.provider === 'github' || !detail.pull.provider) && (
                <FormField label="Teams">
                  <Input
                    aria-label="Review teams"
                    placeholder="Team slugs separated by commas"
                    value={teams}
                    disabled={busy}
                    onChange={(e) => setTeams(e.target.value)}
                  />
                </FormField>
              )}
              <p className="text-xs text-muted-foreground">
                {operation === 'remove'
                  ? 'Removes requests for the selected people'
                  : 'Requests review from the selected people'}
                {detail.pull.provider === 'github' ? ' and teams' : ''}. Other requests remain.
              </p>
            </>
          )}
          {kind === 'merge' && (
            <>
              <p className="break-words text-sm">
                Merge <strong>{detail.pull.title}</strong> into <code>{detail.pull.base}</code>.
              </p>
              <FormField label="Merge method">
                <ChoicePicker
                  aria-label="Merge method"
                  value={method}
                  disabled={busy}
                  onValueChange={(value) => {
                    if (value === 'merge' || value === 'squash' || value === 'rebase')
                      setMethod(value)
                  }}
                >
                  {detail.capabilities?.mergeMethods.map((value) => (
                    <option key={value} value={value}>
                      {value === 'merge'
                        ? 'Merge commit'
                        : value === 'squash'
                          ? 'Squash and merge'
                          : 'Rebase and merge'}
                    </option>
                  ))}
                </ChoicePicker>
              </FormField>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={confirmed}
                  disabled={busy}
                  onCheckedChange={(value) => setConfirmed(value === true)}
                  aria-label="Confirm merge of reviewed commit"
                />
                <span>
                  Merge the reviewed commit {scope.headSha.slice(0, 8)}. Repository rules still
                  apply.
                </span>
              </label>
            </>
          )}
          {['comment', 'reply', 'review', 'edit', 'merge'].includes(kind) && (
            <FormField
              label={
                kind === 'edit'
                  ? 'Description'
                  : kind === 'merge'
                    ? 'Commit message (optional)'
                    : kind === 'review' && event === 'approve'
                      ? 'Review (optional)'
                      : 'Comment'
              }
            >
              <Textarea
                aria-label="PR action body"
                className="min-h-32"
                value={body}
                disabled={busy}
                maxLength={60000}
                placeholder="Markdown supported"
                onChange={(e) => setBody(e.target.value)}
              />
            </FormField>
          )}
          {kind === 'close' && (
            <p className="text-sm">Close this pull request without merging its changes?</p>
          )}
          {kind === 'reopen' && <p className="text-sm">Reopen this pull request for review?</p>}
          {kind === 'resolve' && (
            <p className="text-sm">
              {comment?.resolved
                ? 'Mark this review thread as needing attention again?'
                : 'Mark this review thread as resolved?'}
            </p>
          )}
          {error && (
            <div role="alert" className="space-y-2 text-xs text-destructive">
              <p>{error}</p>
              <p>If the response was lost after submission, refresh the PR before retrying.</p>
            </div>
          )}
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || busy || !connected}>
              {busy ? 'Submitting…' : label}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
