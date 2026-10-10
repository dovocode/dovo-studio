import { useState } from 'react'
import { SlidersHorizontal, X, List, Columns3 } from 'lucide-react'
import { hasJiraIssueFilters, type ForgeIssue, type JiraIssueFilters } from '@dovo/protocol'
import { Button, Input, Popover, ChoicePicker } from '@dovo/studio-ui'
import type { WorkSource } from './work-sources'

export function JiraToolbar({
  state,
  onState,
  filters,
  onFilters,
  view,
  onView,
  issues,
  sources,
  source,
  onSource,
  linked,
  onLinked,
  sort,
  onSort,
  onClear,
}: {
  state: string
  onState: (state: string) => void
  filters: JiraIssueFilters
  onFilters: (filters: JiraIssueFilters) => void
  view: 'list' | 'board'
  onView: (view: 'list' | 'board') => void
  issues: ForgeIssue[]
  sources: WorkSource[]
  source: string
  onSource: (source: string) => void
  linked: string
  onLinked: (value: string) => void
  sort: string
  onSort: (value: string) => void
  onClear: () => void
}) {
  const [search, setSearch] = useState('')
  const presets = [
    { name: 'Open', state: 'open', assignee: 'all' },
    { name: 'My issues', state: 'open', assignee: 'mine' },
    { name: 'Unassigned', state: 'open', assignee: 'unassigned' },
    { name: 'Done', state: 'closed', assignee: 'all' },
  ] as const
  const choices = [
    {
      key: 'priority',
      name: 'Priority',
      values: issues.flatMap((issue) => (issue.priority ? [issue.priority] : [])),
    },
    { key: 'type', name: 'Issue type', values: issues.map((issue) => issue.type) },
    { key: 'label', name: 'Label', values: issues.flatMap((issue) => issue.labels) },
  ] as const
  const chip = (label: string, clear: () => void) => (
    <Button
      key={label}
      type="button"
      size="sm"
      variant="secondary"
      className="h-7 gap-1 text-xs"
      aria-label={`Remove ${label} filter`}
      onClick={clear}
    >
      {label}
      <X className="size-3" />
    </Button>
  )
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Jira quick views">
          {presets.map((preset) => (
            <Button
              key={preset.name}
              type="button"
              size="sm"
              variant={
                state === preset.state &&
                (filters.assignee ?? 'all') === preset.assignee &&
                !filters.statusCategory
                  ? 'secondary'
                  : 'ghost'
              }
              aria-pressed={
                state === preset.state &&
                (filters.assignee ?? 'all') === preset.assignee &&
                !filters.statusCategory
              }
              onClick={() => {
                onState(preset.state)
                onFilters({ ...filters, assignee: preset.assignee, statusCategory: undefined })
              }}
            >
              {preset.name}
            </Button>
          ))}
        </div>
        <Popover.Root>
          <Popover.Trigger asChild>
            <Button type="button" size="sm" variant="outline">
              <SlidersHorizontal className="size-3.5" />
              Filters
            </Button>
          </Popover.Trigger>
          <Popover.Portal>
            <Popover.Content
              aria-label="Jira filters"
              sideOffset={8}
              align="start"
              className="z-50 max-h-[70vh] w-80 max-w-[calc(100vw-24px)] space-y-4 overflow-y-auto rounded-lg border bg-popover p-4 text-popover-foreground shadow-md"
            >
              <h3 className="text-sm font-medium">Narrow your issues</h3>
              <div className="flex flex-wrap gap-1" role="group" aria-label="Status category">
                {(
                  [
                    ['all', 'All statuses'],
                    ['todo', 'To do'],
                    ['in-progress', 'In progress'],
                    ['done', 'Done'],
                  ] as const
                ).map(([value, label]) => (
                  <Button
                    type="button"
                    key={value}
                    size="sm"
                    variant={
                      (filters.statusCategory ?? 'all') === value && state === 'all'
                        ? 'secondary'
                        : 'ghost'
                    }
                    aria-pressed={(filters.statusCategory ?? 'all') === value && state === 'all'}
                    onClick={() => {
                      onState('all')
                      onFilters({ ...filters, statusCategory: value === 'all' ? undefined : value })
                    }}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              <ChoicePicker aria-label="Jira source" value={source} onValueChange={onSource}>
                <option value="">All sources</option>
                {sources.map((entry) => (
                  <option key={entry.key} value={entry.key}>
                    {entry.name} · {entry.runtimeName}
                  </option>
                ))}
              </ChoicePicker>
              <Input
                maxLength={100}
                aria-label="Find filter values"
                placeholder="Find a status, priority, type or label…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Suggestions come from loaded issues. Applied filters search Jira. My issues uses the
                signed-in account on each source’s computer.
              </p>
              <section aria-label="Workflow status" className="space-y-1">
                <h4 className="text-xs font-medium">Workflow status</h4>
                <div className="flex flex-wrap gap-1">
                  {[
                    ...new Set([
                      ...issues.map((issue) => issue.state),
                      ...(!['open', 'all', 'closed'].includes(state) ? [state] : []),
                    ]),
                  ]
                    .sort()
                    .filter((value) => value.toLowerCase().includes(search.toLowerCase()))
                    .slice(0, 12)
                    .map((value) => (
                      <Button
                        type="button"
                        key={value}
                        size="sm"
                        variant={state === value ? 'secondary' : 'ghost'}
                        aria-pressed={state === value}
                        onClick={() => {
                          onState(value)
                          onFilters({ ...filters, statusCategory: undefined })
                        }}
                      >
                        {value}
                      </Button>
                    ))}
                  {search.trim() && !issues.some((issue) => issue.state === search.trim()) && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        onState(search.trim())
                        onFilters({ ...filters, statusCategory: undefined })
                      }}
                    >
                      Use “{search.trim()}”
                    </Button>
                  )}
                </div>
              </section>
              {choices.map((group) => (
                <section key={group.key} aria-label={group.name} className="space-y-1">
                  <h4 className="text-xs font-medium">{group.name}</h4>
                  <div className="flex flex-wrap gap-1">
                    {[
                      ...new Set([
                        ...group.values,
                        ...(filters[group.key] ? [filters[group.key]!] : []),
                      ]),
                    ]
                      .filter(Boolean)
                      .sort()
                      .filter((value) => value.toLowerCase().includes(search.toLowerCase()))
                      .slice(0, 12)
                      .map((value) => (
                        <Button
                          key={value}
                          type="button"
                          size="sm"
                          className="max-w-full whitespace-normal break-words text-left text-xs"
                          variant={filters[group.key] === value ? 'secondary' : 'ghost'}
                          aria-pressed={filters[group.key] === value}
                          onClick={() =>
                            onFilters({
                              ...filters,
                              [group.key]: filters[group.key] === value ? undefined : value,
                            })
                          }
                        >
                          {value}
                        </Button>
                      ))}
                    {search.trim() && !group.values.includes(search.trim()) && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => onFilters({ ...filters, [group.key]: search.trim() })}
                      >
                        Use “{search.trim()}”
                      </Button>
                    )}
                  </div>
                </section>
              ))}
              <ChoicePicker aria-label="Project links" value={linked} onValueChange={onLinked}>
                <option value="all">All project links</option>
                <option value="unlinked">Not linked to a project</option>
                <option value="linked">Linked to a project</option>
              </ChoicePicker>
              <p className="text-xs text-muted-foreground">
                Project links filter loaded results in Dovo.
              </p>
              <ChoicePicker aria-label="Sort results" value={sort} onValueChange={onSort}>
                <option value="updated">Jira order · per source</option>
                <option value="project">Source</option>
                <option value="title">Title · within each source</option>
              </ChoicePicker>
            </Popover.Content>
          </Popover.Portal>
        </Popover.Root>
        <div className="ml-auto flex gap-1" role="group" aria-label="Jira layout">
          {(['list', 'board'] as const).map((layout) => (
            <Button
              key={layout}
              type="button"
              size="sm"
              variant={view === layout ? 'secondary' : 'ghost'}
              aria-pressed={view === layout}
              onClick={() => onView(layout)}
            >
              {layout === 'list' ? (
                <List className="size-3.5" />
              ) : (
                <Columns3 className="size-3.5" />
              )}
              {layout === 'list' ? 'List' : 'Board'}
            </Button>
          ))}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5" aria-label="Active Jira filters">
        {filters.assignee &&
          filters.assignee !== 'all' &&
          chip(filters.assignee === 'mine' ? 'Assigned to me' : 'Unassigned', () =>
            onFilters({ ...filters, assignee: undefined }),
          )}
        {source &&
          chip(sources.find((entry) => entry.key === source)?.name ?? 'Source', () => onSource(''))}
        {!['open', 'all', 'closed'].includes(state) &&
          chip(`Status: ${state}`, () => onState('open'))}
        {state === 'all' && !filters.statusCategory && chip('All statuses', () => onState('open'))}
        {filters.statusCategory &&
          chip(
            filters.statusCategory === 'todo'
              ? 'To do'
              : filters.statusCategory === 'done'
                ? 'Done'
                : 'In progress',
            () => onFilters({ ...filters, statusCategory: undefined }),
          )}
        {choices.map((group) =>
          filters[group.key]
            ? chip(`${group.name}: ${filters[group.key]}`, () =>
                onFilters({ ...filters, [group.key]: undefined }),
              )
            : null,
        )}
        {linked !== 'all' &&
          chip(linked === 'linked' ? 'Linked project' : 'No linked project', () => onLinked('all'))}
        {(source || linked !== 'all' || state !== 'open' || hasJiraIssueFilters(filters)) && (
          <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={onClear}>
            Clear filters
          </Button>
        )}
      </div>
    </div>
  )
}
