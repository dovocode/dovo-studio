import { useRef } from 'react'
import { CircleDot } from 'lucide-react'
import { issueLabel, type ForgeIssue } from '@dovo/studio-core'
import type { WorkSource } from './work-sources'
import { formatDate } from './format-date'

type Row = { source: WorkSource; item: ForgeIssue; stale?: boolean; cachedAt?: string }
export const jiraIssueRowKey = (source: WorkSource, id: string) => JSON.stringify([source.key, id])

export function JiraIssueList({
  rows,
  layout = 'list',
  selected,
  opening,
  onOpen,
}: {
  rows: Row[]
  layout?: 'list' | 'board'
  selected: { source: WorkSource; id: string } | null
  opening: boolean
  onOpen: (source: WorkSource, id: string, url: string) => Promise<void>
}) {
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  if (layout === 'board') {
    const statuses = [...new Set(rows.map((row) => row.item.state))].sort()
    return (
      <div className="space-y-3" aria-label="Jira status board">
        <p className="text-xs text-muted-foreground">
          Columns show workflow statuses in loaded results. Open an issue to change its status.
        </p>
        <div className="flex items-start gap-3 overflow-x-auto pb-3">
          {statuses.map((status) => {
            const issues = rows.filter((row) => row.item.state === status)
            return (
              <section
                key={status}
                aria-label={`${status} column`}
                className="w-80 min-w-64 shrink-0 rounded-lg border bg-muted/10"
              >
                <h2 className="flex items-center justify-between gap-2 border-b px-3 py-3 text-sm font-medium">
                  <span className="break-words">{status}</span>
                  <span className="text-xs text-muted-foreground">{issues.length} loaded</span>
                </h2>
                <JiraIssueList
                  rows={issues}
                  selected={selected}
                  opening={opening}
                  onOpen={onOpen}
                />
              </section>
            )
          })}
        </div>
      </div>
    )
  }
  const groups = new Map<string, Row[]>()
  for (const row of rows) {
    const group = groups.get(row.source.key) ?? []
    group.push(row)
    groups.set(row.source.key, group)
  }
  const ordered = [...groups.values()].flat()
  return (
    <div className="@container/jira-list" aria-label="Jira issue results">
      {!!rows.length && (
        <div
          aria-hidden="true"
          className="hidden grid-cols-[minmax(0,1fr)_7rem_5rem_7rem] gap-3 border-b px-3 py-2 text-xs text-muted-foreground @xl/jira-list:grid"
        >
          <span>Issue</span>
          <span>Status</span>
          <span>Priority</span>
          <span>Assignee</span>
        </div>
      )}
      {[...groups.entries()].map(([key, group]) => {
        const { source, stale, cachedAt } = group[0]!
        return (
          <section key={key} aria-label={`${source.name} · ${source.runtimeName}`}>
            <h2 className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b bg-muted/20 px-3 py-2 text-xs font-medium text-muted-foreground">
              <span className="break-words">
                {source.name} · {source.jira?.project} · {source.runtimeName}
              </span>
              <span className="font-normal">
                {group.length} loaded{!source.connected ? ' · Offline' : stale ? ' · Cached' : ''}
              </span>
              {cachedAt && (
                <span
                  className="ml-auto font-normal"
                  title="Oldest fetch time among the loaded pages"
                >
                  Synced {formatDate(cachedAt)}
                </span>
              )}
            </h2>
            <div className="divide-y">
              {group.map(({ source, item }) => {
                const key = jiraIssueRowKey(source, item.id)
                const active = selected?.source.scope === source.scope && selected.id === item.id
                const assignee = (item.assigneeNames ?? item.assignees).join(', ') || 'Unassigned'
                const priority = item.priority || '—'
                return (
                  <button
                    type="button"
                    key={key}
                    ref={(button) => {
                      if (button) buttons.current.set(key, button)
                      else buttons.current.delete(key)
                    }}
                    data-work-item={key}
                    aria-label={`${issueLabel(item.id)} · ${item.title} · ${item.state} · ${item.priority ? `${item.priority} priority` : 'No priority'} · ${assignee}`}
                    aria-current={active ? 'true' : undefined}
                    disabled={opening}
                    className={`grid w-full min-w-0 grid-cols-[minmax(0,1fr)_7rem] items-start gap-3 px-3 py-3 text-left text-xs transition-colors hover:bg-muted/30 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary disabled:opacity-60 @xl/jira-list:grid-cols-[minmax(0,1fr)_7rem_5rem_7rem] ${active ? 'bg-accent' : ''}`}
                    onClick={() => void onOpen(source, item.id, item.url)}
                    onKeyDown={(event) => {
                      if (!['ArrowUp', 'ArrowDown'].includes(event.key)) return
                      event.preventDefault()
                      const current = ordered.findIndex(
                        (row) => jiraIssueRowKey(row.source, row.item.id) === key,
                      )
                      const next =
                        ordered[
                          Math.max(
                            0,
                            Math.min(
                              ordered.length - 1,
                              current + (event.key === 'ArrowDown' ? 1 : -1),
                            ),
                          )
                        ]
                      if (!next) return
                      void onOpen(next.source, next.item.id, next.item.url).then(() => {
                        buttons.current
                          .get(jiraIssueRowKey(next.source, next.item.id))
                          ?.focus({ preventScroll: false })
                      })
                    }}
                  >
                    <span className="min-w-0 space-y-1">
                      <span className="block break-words text-sm font-medium">{item.title}</span>
                      <span className="block break-words text-muted-foreground">
                        {issueLabel(item.id)} · {item.type}
                        {item.labels.length ? ` · ${item.labels.slice(0, 3).join(', ')}` : ''}
                        {item.labels.length > 3 ? ` · +${item.labels.length - 3} labels` : ''}
                      </span>
                      <span className="block break-words text-muted-foreground @xl/jira-list:hidden">
                        {item.priority ? `${priority} priority · ` : ''}
                        {assignee}
                      </span>
                      {source.projectLinks?.[item.id] && (
                        <span className="block break-words text-muted-foreground">
                          Project: {source.projectLinks[item.id]}
                        </span>
                      )}
                    </span>
                    <span className="inline-flex min-w-0 items-start gap-1.5 break-words text-muted-foreground">
                      <CircleDot className="mt-0.5 size-3 shrink-0" />
                      {item.state}
                    </span>
                    <span className="hidden min-w-0 break-words @xl/jira-list:block">
                      {priority}
                    </span>
                    <span className="hidden min-w-0 break-words text-muted-foreground @xl/jira-list:block">
                      {assignee}
                    </span>
                  </button>
                )
              })}
            </div>
          </section>
        )
      })}
      {!!rows.length && (
        <p className="px-3 py-3 text-xs text-muted-foreground">
          ↑ ↓ browse issues · Enter to preview · Esc to close
        </p>
      )}
    </div>
  )
}
