import {
  useSettingsTarget,
  type SettingsSection,
  type SettingsStorage,
  type StudioView,
} from '@dovo/studio-core'
import { useApplicationState } from '@dovo/studio-core/state'
import { settingsScopeLabels } from '@dovo/protocol'
import { ChoicePicker, Input } from '@dovo/studio-ui'
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
  Layers,
  MessagesSquare,
  Download,
  Monitor,
  MonitorSmartphone,
  Palette,
  Search,
  Settings2,
  Smartphone,
  Terminal,
  Wrench,
  X,
} from 'lucide-react'

const icons: Record<string, typeof Search> = {
  general: Settings2,
  'conversation-settings': MessagesSquare,
  'updates-settings': Download,
  'text-generation': MessagesSquare,
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
  ['app', 'This app'],
  ['agents', 'Agents'],
  ['coding', 'Tasks & projects'],
  ['computers', 'Computers'],
  ['archived', 'History'],
  ['more', 'More'],
]

/** Where a page saves, shown beside its name and explained in the legend below the list. */
const storage: Record<SettingsStorage, { icon: typeof Search; label: string }> = {
  device: { icon: Smartphone, label: 'Saved on this device' },
  computer: { icon: Monitor, label: 'Saved per computer' },
  inherited: { icon: Layers, label: 'Inherits across settings levels' },
}

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
  const { target, scope, source, repository } = useSettingsTarget()
  const select = (id: string) => {
    if (id !== activeId) onSelect(id)
  }
  const needle = query.trim().toLowerCase()
  const matches = views.filter((view) => {
    if (!needle) return true
    const words = `${view.title} ${view.keywords ?? ''}`.toLowerCase().split(/\s+/)
    return (
      needle.split(/\s+/).every((term) => words.some((word) => word.startsWith(term))) ||
      view.title.toLowerCase().includes(needle)
    )
  })
  const project = repository?.name ?? (target.projectId ? 'Unavailable project' : 'All projects')
  const computer = target.environmentId ? (source?.name ?? 'Unavailable computer') : 'All computers'
  return (
    <nav
      aria-label="Settings sections"
      className="flex shrink-0 flex-col border-b bg-sidebar/60 px-4 py-3 md:w-52 md:gap-5 md:overflow-y-auto md:border-b-0 md:border-r md:px-3 md:py-5 lg:w-56"
    >
      <div className="md:hidden">
        <ChoicePicker aria-label="Settings section" value={activeId} onValueChange={select}>
          {headings.flatMap(([section]) =>
            views
              .filter((view) => (view.settingsSection ?? 'more') === section)
              .sort((a, b) => a.order - b.order)
              .map((view) => (
                <option key={view.id} value={view.id}>
                  {view.title}
                </option>
              )),
          )}
        </ChoicePicker>
      </div>
      <div className="hidden px-1 md:block">
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
              if (event.key === 'Enter' && matches[0]) select(matches[0].id)
              if (event.key === 'Escape') setQuery('')
            }}
            className="h-9 rounded-lg border-border/70 bg-background/70 pl-8"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear settings search"
              onClick={() => setQuery('')}
              className="absolute right-1 top-1 rounded p-1.5 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>
      {headings.map(([section, label]) => {
        const items = matches
          .filter((view) => (view.settingsSection ?? 'more') === section)
          .sort((a, b) => a.order - b.order)
        if (!items.length) return null
        return (
          <div key={section} className="hidden space-y-1 text-sm md:block">
            <h2 className="px-2 pb-1 text-[0.625rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground/80">
              {label}
            </h2>
            {items.map((view) => {
              const Icon = icons[view.id] ?? Settings2
              const active = activeId === view.id
              const kind = view.settingsScope && view.settingsScope !== 'device'
              const Storage = kind ? storage[view.settingsScope ?? 'device'].icon : null
              return (
                <button
                  key={view.id}
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() => select(view.id)}
                  className={`group flex min-h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-[0.8125rem] transition-colors ${
                    active
                      ? 'bg-accent/70 font-medium text-foreground'
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
                  {Storage && view.settingsScope && (
                    <Storage
                      size={12}
                      aria-label={storage[view.settingsScope].label}
                      className={`shrink-0 ${view.settingsScope === 'inherited' ? 'text-primary/70' : 'text-muted-foreground/60'}`}
                    />
                  )}
                  {active && (
                    <ChevronRight size={13} aria-hidden="true" className="text-muted-foreground" />
                  )}
                </button>
              )
            })}
          </div>
        )
      })}
      {!matches.length && (
        <p role="status" className="hidden px-2 text-xs text-muted-foreground md:block">
          No settings match “{query}”.
        </p>
      )}
      <div
        aria-label="Inherited settings target"
        className="mt-auto hidden space-y-2 border-t px-2 pt-4 text-[11px] leading-relaxed text-muted-foreground md:block"
      >
        <p className="flex items-center gap-1.5">
          <Layers className="size-3 text-primary/70" aria-hidden="true" />
          Applying inherited settings for
        </p>
        <p className="break-words font-medium text-foreground [overflow-wrap:anywhere]">
          {project} · {computer}
        </p>
        <p>
          {settingsScopeLabels[scope]} level, kept while you move between pages. Pages marked{' '}
          <Layers className="inline size-3 align-[-2px]" aria-hidden="true" /> use it;{' '}
          <Monitor className="inline size-3 align-[-2px]" aria-hidden="true" /> pages save per
          computer; other pages save on this device.
        </p>
      </div>
    </nav>
  )
}
