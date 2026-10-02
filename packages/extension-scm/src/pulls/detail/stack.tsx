import { Layers, Plus, RefreshCw } from 'lucide-react'
import { pullHeadBranch, pullStackLabel, type PullDetail } from '@dovo/protocol'
import { Button } from '@dovo/studio-ui'
export function PullStack({
  detail,
  connected,
  onSelect,
  onCreate,
  onUpdate,
}: {
  detail: PullDetail
  connected: boolean
  onSelect: (number: number) => void
  onCreate: () => void
  onUpdate: () => void
}) {
  const stack = detail.stack
  if (!stack && detail.pull.state !== 'open') return null
  return (
    <section
      aria-label="Pull request stack"
      className="space-y-3 rounded-lg border border-border/60 bg-card p-3 text-xs"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Layers className="size-4 text-violet-400" aria-hidden />
        <span className="mr-auto font-medium">
          {stack ? pullStackLabel(stack) : 'Build a stack'}
        </span>
        <Button
          size="sm"
          variant="outline"
          disabled={!connected || detail.pull.state !== 'open' || !pullHeadBranch(detail.pull)}
          onClick={onCreate}
        >
          <Plus className="size-3" />
          Stack a PR
        </Button>
        {stack && (
          <Button
            size="sm"
            variant="outline"
            disabled={!connected || detail.stale}
            onClick={onUpdate}
          >
            <RefreshCw className="size-3" />
            Ask agent to update stack
          </Button>
        )}
      </div>
      {stack ? (
        <>
          {!stack.complete && (
            <p className="text-muted-foreground">
              Partial stack: refresh to verify all dependencies before updating.
            </p>
          )}
          <ol className="space-y-1">
            {stack.members.map((pull) => (
              <li key={pull.number} style={{ paddingLeft: pull.depth * 12 }}>
                <button
                  type="button"
                  aria-current={pull.number === detail.pull.number ? 'true' : undefined}
                  disabled={pull.number === detail.pull.number}
                  onClick={() => onSelect(pull.number)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-accent/50 aria-[current=true]:bg-accent/50"
                >
                  <span className="shrink-0 font-mono">#{pull.number}</span>
                  <span className="min-w-0 flex-1 truncate">{pull.title}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {pull.parentNumber ? `on #${pull.parentNumber}` : 'Base PR'}
                    {pull.draft ? ' · Draft' : ''}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          <p className="text-muted-foreground">
            Review and merge parents before their dependent PRs. Update stack opens a draft for your
            agent.
          </p>
        </>
      ) : (
        <p className="text-muted-foreground">
          Create the next PR against this PR’s branch to keep its changes separate.
        </p>
      )}
    </section>
  )
}
