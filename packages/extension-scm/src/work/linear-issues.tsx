import { useCallback, useState } from 'react'
import {
  linearIssuesSchema,
  randomUUID,
  linearIssueSources,
  runtimeComputerName,
  type RuntimeOverview,
  type linearIssueQuerySchema,
} from '@dovo/protocol'
import { useLinearIssues, useLinearIssueActions, useWorkspace } from '@dovo/studio-core'
import { copyTextToClipboard } from '@dovo/studio-ui/clipboard'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { Button, Dialog, DialogContent, DialogTitle } from '@dovo/studio-ui'

export function LinearIssuesDialog({
  sources,
  onClose,
}: {
  sources: RuntimeOverview[]
  onClose: () => void
}) {
  const uiText = useInterfaceText()
  const [id, setId] = useState(sources[0]?.profile.id ?? '')
  const source = sources.find(({ profile }) => profile.id === id)
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-auto">
        <DialogTitle>{uiText('Linear issues')}</DialogTitle>
        {sources.length > 1 && (
          <label className="grid gap-1 text-sm">
            {uiText('Computer')}
            <select
              value={id}
              onChange={(event) => setId(event.target.value)}
              className="rounded border p-2"
            >
              {sources.map((source) => (
                <option key={source.profile.id} value={source.profile.id}>
                  {runtimeComputerName(source)}
                </option>
              ))}
            </select>
          </label>
        )}
        {source ? (
          <LinearSources key={id} source={source} />
        ) : (
          <p>{uiText('Linear is unavailable.')}</p>
        )}
      </DialogContent>
    </Dialog>
  )
}

function LinearSources({ source }: { source: RuntimeOverview }) {
  const uiText = useInterfaceText()
  const options = linearIssueSources(
    source.snapshot?.linearConnections,
    source.snapshot?.workspace.repositories ?? [],
    source.snapshot?.linearKeySource !== 'none',
  )
  const [id, setId] = useState(options[0]?.id ?? '')
  const selected = options.find((item) => item.id === id)
  return (
    <>
      {(options.length > 1 || !selected) && (
        <label className="grid gap-1 text-sm">
          {uiText('Linear source')}
          <select
            value={selected ? id : ''}
            onChange={(event) => setId(event.target.value)}
            className="rounded border p-2"
          >
            {!selected && <option value="">{uiText('Select a Linear source')}</option>}
            {options.map((item) => (
              <option key={item.id} value={item.id}>
                {uiText(item.name)}
              </option>
            ))}
          </select>
        </label>
      )}
      {selected && <LinearList key={id} source={source} selection={selected.input} />}
    </>
  )
}

function LinearList({
  source,
  selection,
}: {
  source: RuntimeOverview
  selection: Pick<typeof linearIssueQuerySchema.Type, 'connectionId' | 'repositoryId'>
}) {
  const uiText = useInterfaceText()
  const { readRuntime } = useWorkspace()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string>()
  const [notice, setNotice] = useState('')
  const { connectionId, repositoryId } = selection
  const read = useCallback(
    (input: typeof linearIssueQuerySchema.Type) =>
      readRuntime(
        source.profile,
        '/api/scm/linear/issues/read',
        { ...input, connectionId, repositoryId },
        linearIssuesSchema,
      ),
    [readRuntime, source.profile, connectionId, repositoryId],
  )
  const issues = useLinearIssues(read)
  return (
    <div className="grid min-w-0 gap-3">
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void issues.go(search)
        }}
      >
        <input
          className="min-w-0 flex-1 rounded border px-3 py-1.5"
          aria-label={uiText('Search Linear issues')}
          placeholder={uiText('Title or issue ID')}
          value={search}
          maxLength={200}
          onChange={(event) => setSearch(event.target.value)}
        />
        <Button type="submit">{uiText('Search')}</Button>
      </form>
      {issues.error && <p role="alert">{issues.error}</p>}
      {issues.busy && <p role="status">{uiText('Loading issues…')}</p>}
      {!issues.busy && !issues.error && !issues.items.length && <p>{uiText('No issues found.')}</p>}
      {issues.items.map((issue) => (
        <details
          key={issue.id}
          className="rounded border p-2"
          onToggle={(event) => {
            const open = event.currentTarget.open
            setSelected((current) => (open ? issue.id : current === issue.id ? undefined : current))
          }}
        >
          <summary className="cursor-pointer break-words">
            <span className="text-muted-foreground">
              {issue.identifier} · {issue.status}
            </span>{' '}
            {issue.title}
          </summary>
          <p className="my-2 whitespace-pre-wrap break-words">{issue.description}</p>
          {source.snapshot?.linearIssueActionsSupported && selected === issue.id && (
            <LinearIssueEditor
              key={issue.id}
              source={source}
              selection={selection}
              issueId={issue.id}
              onStatus={(status) => issues.updateStatus(issue.id, status)}
            />
          )}
          <div className="flex flex-wrap items-center gap-3">
            <a href={issue.url} target="_blank" rel="noreferrer" className="text-primary underline">
              {uiText('Open in Linear')}
            </a>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                void copyTextToClipboard(
                  `${issue.identifier} ${issue.title}\n${issue.url}\n\n${issue.description}`,
                ).then(
                  () => setNotice(uiText('Issue copied.')),
                  () => setNotice(uiText('Could not copy issue.')),
                )
              }
            >
              {uiText('Copy issue')}
            </Button>
          </div>
        </details>
      ))}
      {issues.next && (
        <Button variant="outline" disabled={issues.busy} onClick={() => void issues.more()}>
          {uiText('Load more')}
        </Button>
      )}
      {notice && <p role="status">{notice}</p>}
    </div>
  )
}

function LinearIssueEditor({
  source,
  selection,
  issueId,
  onStatus,
}: {
  source: RuntimeOverview
  selection: Pick<typeof linearIssueQuerySchema.Type, 'connectionId' | 'repositoryId'>
  issueId: string
  onStatus: (status: string) => void
}) {
  const uiText = useInterfaceText()
  const { readRuntime } = useWorkspace()
  const actions = useLinearIssueActions(
    readRuntime,
    source.profile,
    issueId,
    selection,
    randomUUID,
    onStatus,
  )
  const disabled = actions.busy || !source.connected
  return (
    <div className="my-3 grid gap-2">
      {actions.error && <p role="alert">{actions.error}</p>}
      {actions.issue ? (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-sm">
              {uiText('Status')}
              <select
                className="rounded border p-2"
                value={actions.stateId}
                disabled={disabled}
                onChange={(event) => actions.setStateId(event.target.value)}
              >
                {actions.issue.states.map(({ id, name }) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <Button
              type="button"
              disabled={disabled || actions.stateId === actions.issue.state.id}
              onClick={() => void actions.saveStatus()}
            >
              {uiText('Save status')}
            </Button>
          </div>
          {actions.issue.comments.map((comment) => (
            <div key={comment.id} className="min-w-0 rounded border p-2 text-sm">
              <p className="text-muted-foreground">{comment.author}</p>
              <p className="whitespace-pre-wrap break-words">{comment.body}</p>
            </div>
          ))}
          <label className="grid gap-1 text-sm">
            {uiText('Comment')}
            <textarea
              className="min-w-0 rounded border p-2"
              rows={3}
              maxLength={12000}
              value={actions.comment}
              readOnly={actions.busy}
              onChange={(event) => actions.setComment(event.target.value)}
            />
          </label>
          <Button
            className="justify-self-start"
            type="button"
            disabled={disabled || !actions.comment.trim()}
            onClick={() => void actions.postComment()}
          >
            {uiText('Post comment')}
          </Button>
        </>
      ) : (
        actions.busy && <p role="status">{uiText('Loading issues…')}</p>
      )}
    </div>
  )
}
