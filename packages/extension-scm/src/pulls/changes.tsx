import { useState } from 'react'
import { useWorkspace, pullLineCommentResponse, type PullDetail } from '@dovo/studio-core'
import { Button, Checkbox, Input } from '@dovo/studio-ui'
import { PullFileTree } from './file-tree'
import { PullPatch } from './patch'
import { PullComments } from './comments'
export function PullChanges({
  detail,
  repositoryId,
  onSteer,
  onPosted,
}: {
  detail: PullDetail
  repositoryId: string
  onSteer: (objective: string) => void
  onPosted: () => void
}) {
  const { request, connected } = useWorkspace()
  const [selected, setSelected] = useState(detail.files[0]?.path ?? ''),
    [split, setSplit] = useState(false),
    [treeOpen, setTreeOpen] = useState(true),
    [query, setQuery] = useState(''),
    [viewed, setViewed] = useState<Set<string>>(new Set())
  const file = detail.files.find((f) => f.path === selected) ?? detail.files[0]
  const index = detail.files.findIndex((f) => f.path === file?.path)
  if (!file) return <p className="p-4 text-xs text-muted-foreground">No changed files returned.</p>
  const comments = detail.comments.filter(
    (c) => c.kind === 'inline' && (c.path === file.path || c.path === file.previousPath),
  )
  return (
    <section aria-label="Code changes" className="min-w-0">
      <div className="flex flex-wrap items-center gap-2 border-y py-2 text-xs">
        <h3 className="mr-auto font-medium">
          Code changes · {viewed.size}/{detail.files.length} viewed
        </h3>
        <Button size="sm" variant="outline" onClick={() => setSplit((v) => !v)}>
          {split ? 'Split diff' : 'Unified diff'}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-pressed={treeOpen}
          onClick={() => setTreeOpen((v) => !v)}
        >
          {treeOpen ? 'Hide files' : 'Show files'}
        </Button>
      </div>
      <div className="flex min-w-0 flex-col-reverse gap-3 lg:flex-row">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2 py-3">
            <span className="min-w-0 flex-1 break-all font-mono text-xs">
              {file.previousPath ? `${file.previousPath} → ` : ''}
              {file.path}
            </span>
            <span className="text-xs">
              {file.additions !== null && <span className="text-green-400">+{file.additions}</span>}{' '}
              {file.deletions !== null && <span className="text-red-400">−{file.deletions}</span>}
            </span>
            <label className="flex items-center gap-1 text-xs">
              <Checkbox
                checked={viewed.has(file.path)}
                onCheckedChange={(checked) =>
                  setViewed((current) => {
                    const next = new Set(current)
                    if (checked === true) next.add(file.path)
                    else next.delete(file.path)
                    return next
                  })
                }
              />
              Viewed
            </label>
          </div>
          <PullPatch
            key={file.path}
            file={file}
            split={split}
            provider={detail.pull.provider}
            allowInlineComment={detail.capabilities?.actions.includes('inline-comment') ?? true}
            allowInlineRange={detail.capabilities?.inlineRange ?? true}
            onComment={
              connected
                ? async (body, range, destination) => {
                    if (destination === 'github') {
                      await request(
                        '/api/scm/pulls/comment',
                        {
                          repositoryId,
                          number: detail.pull.number,
                          headSha: detail.pull.headSha,
                          path: file.path,
                          body,
                          ...range,
                        },
                        pullLineCommentResponse,
                      )
                      onPosted()
                    } else
                      onSteer(
                        `Address this feedback on ${file.path}:${range.start}-${range.end} (${range.side === 'additions' ? 'new' : 'old'} version), PR commit ${detail.pull.headSha}:\n${body}\n\nReference patch at time of comment:\n${(file.patch ?? '').slice(0, 1500)}`,
                      )
                  }
                : undefined
            }
          />
          <div className="flex flex-wrap items-center justify-between gap-2 border-y py-2">
            <Button
              size="sm"
              variant="ghost"
              disabled={index <= 0}
              onClick={() => setSelected(detail.files[index - 1].path)}
            >
              Previous file
            </Button>
            <span className="text-xs text-muted-foreground">
              {index + 1} of {detail.files.length}
            </span>
            <Button
              size="sm"
              variant="ghost"
              disabled={index >= detail.files.length - 1}
              onClick={() => setSelected(detail.files[index + 1].path)}
            >
              Next file
            </Button>
          </div>
          <h4 className="my-3 text-xs font-medium">Feedback on this file ({comments.length})</h4>
          <PullComments
            comments={comments}
            fileBaseURL={
              detail.fileBaseUrl ?? `${detail.pull.repositoryUrl}/blob/${detail.pull.headSha}/`
            }
            actionContext={{ repositoryId, detail, onDone: onPosted }}
          />
        </div>
        {treeOpen && (
          <aside className="max-h-[65vh] shrink-0 overflow-y-auto border-l p-2 lg:sticky lg:top-2 lg:w-56">
            <Input
              aria-label="Filter changed files"
              placeholder="Find a file…"
              className="mb-2 h-8 text-xs"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <PullFileTree
              files={detail.files.filter((f) => f.path.toLowerCase().includes(query.toLowerCase()))}
              selected={file.path}
              viewed={viewed}
              onSelect={setSelected}
            />
          </aside>
        )}
      </div>
    </section>
  )
}
