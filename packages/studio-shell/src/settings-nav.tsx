import type { SettingsSection, StudioView } from '@dovo/studio-core'
import { useApplicationState } from '@dovo/studio-core/state'
import { Input } from '@dovo/studio-ui'
import {
  Archive,
  Bell,
  Bot,
  ChartNoAxesCombined,
  ChevronRight,
  Command,
  GitBranch,
  GitPullRequest,
  HardDrive,
  Keyboard,
  ListTodo,
  MonitorSmartphone,
  Palette,
  Search,
  Settings2,
  Terminal,
  Wrench,
} from 'lucide-react'

const icons: Record<string, typeof Search> = {
  general: Settings2,
  notifications: Bell,
  appearance: Palette,
  diffs: GitBranch,
  shortcuts: Keyboard,
  usage: ChartNoAxesCombined,
  agents: Bot,
  resources: Wrench,
  'source-control': GitBranch,
  'pull-request-settings': GitPullRequest,
  'task-defaults': ListTodo,
  commands: Terminal,
  worktrees: HardDrive,
  runtime: MonitorSmartphone,
  'running-tasks': ListTodo,
  activity: Command,
  'archived-tasks': Archive,
}

const headings: readonly [SettingsSection | 'more', string][] = [
  ['app', 'App'],
  ['agents', 'Agents'],
  ['coding', 'Coding'],
  ['computers', 'Computers'],
  ['archived', 'Archived'],
  ['more', 'More'],
]

/** Grouped settings navigation with search, organized like Codex and T3 Code. */
export function SettingsNav({
  views,
  activeId,
  onSelect,
}: {
  views: readonly StudioView[]
  activeId: string
  onSelect: (viewId: string) => void
}) {
  const [query, setQuery] = useApplicationState('')
  const needle = query.trim().toLowerCase()
  const matches = views.filter((view) => {
    if (!needle) return true
    const words = `${view.title} ${view.keywords ?? ''}`.toLowerCase().split(/\s+/)
    return (
      needle.split(/\s+/).every((term) => words.some((word) => word.startsWith(term))) ||
      view.title.toLowerCase().includes(needle)
    )
  })
  return (
    <nav
      aria-label="Settings sections"
      className="flex w-52 shrink-0 flex-col gap-5 overflow-y-auto border-r bg-sidebar/70 px-3 py-4 lg:w-60"
    >
      <div className="px-1">
        <h1 className="mb-3 px-1 text-base font-semibold tracking-tight">Settings</h1>
        {/* Buttons and inputs inherit their font size (see studio-ui styles). */}
        <div className="relative text-[0.8125rem]">
          <Search
            aria-hidden="true"
            className="absolute left-2 top-2 size-3.5 text-muted-foreground"
          />
          <Input
            aria-label="Search settings"
            placeholder="Search settings"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && matches[0]) onSelect(matches[0].id)
              if (event.key === 'Escape') setQuery('')
            }}
            className="h-9 rounded-lg border-border/70 bg-background/70 pl-8"
          />
        </div>
      </div>
      {headings.map(([section, label]) => {
        const items = matches
          .filter((view) => (view.settingsSection ?? 'more') === section)
          .sort((a, b) => a.order - b.order)
        if (!items.length) return null
        return (
          <div key={section} className="space-y-1 text-sm">
            <h2 className="px-2 pb-1 text-[0.625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">
              {label}
            </h2>
            {items.map((view) => {
              const Icon = icons[view.id] ?? Settings2
              const active = activeId === view.id
              return (
                <button
                  key={view.id}
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => onSelect(view.id)}
                  className={`group flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[0.8125rem] transition-colors ${
                    active
                      ? 'bg-primary/10 font-medium text-foreground ring-1 ring-primary/20'
                      : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                  }`}
                >
                  <Icon
                    size={16}
                    strokeWidth={1.7}
                    aria-hidden="true"
                    className={active ? 'text-primary' : 'text-muted-foreground/70'}
                  />
                  <span className="min-w-0 flex-1 truncate">{view.title}</span>
                  {active && <ChevronRight size={13} aria-hidden="true" className="text-primary" />}
                </button>
              )
            })}
          </div>
        )
      })}
      {!matches.length && (
        <p className="px-2 text-[0.8125rem] text-muted-foreground">No settings match “{query}”.</p>
      )}
    </nav>
  )
}
