import { useRef } from 'react'
import { useAppPreferences, whitespaceOnlyPatch } from '@dovo/studio-core'
import { useApplicationState } from '@dovo/studio-core/state'
import {
  useWorkspace,
  pullLineCommentResponse,
  type PullDetail,
  readAppPreferences,
} from '@dovo/studio-core'
import { Button, Checkbox, Input } from '@dovo/studio-ui'
import { PullFileTree } from './file-tree'
import { PullPatch } from './patch'
import { PullComments } from './comments'
export function PullChanges({
  detail,
  repositoryId,
  onSteer,
  onPosted,
  embedded = false,
}: {
  embedded?: boolean
  detail: PullDetail
  repositoryId: string
  onSteer: (objective: string) => void
  onPosted: () => void
}) {
  const { hideWhitespaceChanges } = useAppPreferences()
  const files = detail.files.filter((file) => !hideWhitespaceChanges || !whitespaceOnlyPatch(file))
  const { request, connected } = useWorkspace()
  const [selected, setSelected] = useApplicationState(files[0]?.path ?? ''),
    [split, setSplit] = useApplicationState(
      !embedded && readAppPreferences().diffLayout === 'split',
    ),
    [treeOpen, setTreeOpen] = useApplicationState(true),
    [query, setQuery] = useApplicationState(''),
    [viewed, setViewed] = useApplicationState<Set<string>>(new Set())
  const cards = useRef(new Map<string, HTMLElement>())
  const selectFile = (path: string) => {
    setSelected(path)
    cards.current.get(path)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }
  if (!files.length)
    return <p className="p-4 text-xs text-muted-foreground">No changed files returned.</p>
  return (
    <section aria-label="Code changes" className="min-w-0">
      <div className="flex flex-wrap items-center gap-2 border-y py-2 text-xs">
        <h3 className="mr-auto font-medium">
          {files.filter((file) => viewed.has(file.path)).length} of {files.length} reviewed
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
      <div className="flex min-w-0 flex-col-reverse gap-3 @4xl:flex-row">
        <div className="min-w-0 flex-1 space-y-4 py-3">
          {files.map((file) => {
            const comments = detail.comments.filter(
              (c) => c.kind === 'inline' && (c.path === file.path || c.path === file.previousPath),
            )
            return (
              <article
                key={file.path}
                ref={(element) => {
                  if (element) cards.current.set(file.path, element)
                  else cards.current.delete(file.path)
                }}
                className="scroll-mt-28 overflow-hidden rounded-xl border bg-card/30"
              >
                <div className="px-3">
                  <div className="flex flex-wrap items-center gap-2 py-3">
                    <span className="min-w-0 flex-1 break-all font-mono text-xs">
                      {file.previousPath ? `${file.previousPath} → ` : ''}
                      {file.path}
                    </span>
                    <span className="text-xs">
                      {file.additions !== null && (
                        <span className="text-green-400">+{file.additions}</span>
                      )}{' '}
                      {file.deletions !== null && (
                        <span className="text-red-400">−{file.deletions}</span>
                      )}
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
                      Reviewed
                    </label>
                  </div>
                  <PullPatch
                    key={file.path}
                    file={file}
                    split={split}
                    provider={detail.pull.provider}
                    allowInlineComment={
                      detail.capabilities?.actions.includes('inline-comment') ?? true
                    }
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
                  <h4 className="my-3 text-xs font-medium">
                    Feedback on this file ({comments.length})
                  </h4>
                  <PullComments
                    comments={comments}
                    fileBaseURL={
                      detail.fileBaseUrl ??
                      `${detail.pull.repositoryUrl}/blob/${detail.pull.headSha}/`
                    }
                    actionContext={{
                      repositoryId,
                      detail,
                      onDone: onPosted,
                    }}
                  />
                </div>
              </article>
            )
          })}
        </div>
        {treeOpen && (
          <aside className="flex max-h-[65vh] min-h-0 shrink-0 flex-col overflow-hidden border-b p-2 @4xl:sticky @4xl:top-2 @4xl:w-56 @4xl:self-start @4xl:border-b-0 @4xl:border-l">
            <Input
              aria-label="Filter changed files"
              placeholder="Find a file…"
              className="mb-2 h-8 shrink-0 text-xs"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="min-h-0 overflow-auto overscroll-contain">
              <PullFileTree
                files={files.filter((f) => f.path.toLowerCase().includes(query.toLowerCase()))}
                selected={selected}
                viewed={viewed}
                onSelect={selectFile}
              />
            </div>
          </aside>
        )}
      </div>
    </section>
  )
}
