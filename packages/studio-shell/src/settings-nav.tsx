import {
  useSettingsTarget,
  type SettingsSection,
  type SettingsStorage,
  type StudioView,
} from '@dovo/studio-core'
import { useApplicationState } from '@dovo/studio-core/state'
import { projectDisplayName, settingsScopeLabels } from '@dovo/protocol'
import {
  useLeftSidebar,
  SidebarHeader,
  Input,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@dovo/studio-ui'
import {
  Archive,
  Brain,
  Shapes,
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
  Globe,
  Mic,
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
  'task-list-settings': ListTodo,
  'browser-settings': Globe,
  'conversation-settings': MessagesSquare,
  'updates-settings': Download,
  'text-generation': Mic,
  notifications: Bell,
  appearance: Palette,
  diffs: GitBranch,
  shortcuts: Keyboard,
  usage: ChartNoAxesCombined,
  agents: Bot,
  resources: Wrench,
  'source-control': GitBranch,
  'pull-request-settings': GitPullRequest,
  'pull-request-monitoring-settings': GitPullRequest,
  'task-defaults': ListTodo,
  commands: Terminal,
  worktrees: HardDrive,
  memory: Brain,
  'artifact-settings': Shapes,
  'computer-use': Monitor,
  'remote-desktop': Monitor,
  'device-previews': Smartphone,
  'studio-tools-settings': Wrench,
  runtime: MonitorSmartphone,
  'running-tasks': ListTodo,
  activity: Command,
  'archived-tasks': Archive,
}

const headings: readonly [SettingsSection | 'more', string][] = [
  ['app', 'This app'],
  ['agents', 'Agents & tools'],
  ['coding', 'Tasks & projects'],
  ['computers', 'Computers'],
  ['archived', 'History'],
  ['more', 'More'],
]

/** Where a page saves. Mixed pages explain each group in their content. */
const storage: Record<SettingsStorage, { icon: typeof Search; label: string }> = {
  device: { icon: Smartphone, label: 'This device' },
  computer: { icon: Monitor, label: 'Per computer' },
  inherited: { icon: Layers, label: 'Computer & project' },
}

const mixedPages = new Set(['browser-settings', 'pull-request-monitoring-settings'])

function pageStorage(view?: StudioView) {
  if (view?.id === 'usage') return { icon: ChartNoAxesCombined, label: 'Across computers' }
  if (view && mixedPages.has(view.id))
    return { icon: MonitorSmartphone, label: 'This device + computer' }
  return view?.settingsScope ? storage[view.settingsScope] : null
}

/** Grouped desktop settings navigation, with searchable categories and storage labels. */
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
  const sectionFor = (view: StudioView) => view.settingsSection ?? 'more'
  const ordered = headings.flatMap(([section]) =>
    views.filter((view) => sectionFor(view) === section).sort((a, b) => a.order - b.order),
  )
  const matches = ordered.filter((view) => {
    if (!needle) return true
    const category = headings.find(([section]) => section === sectionFor(view))?.[1] ?? ''
    const words = `${view.title} ${view.keywords ?? ''} ${category}`.toLowerCase().split(/\s+/)
    return (
      needle.split(/\s+/).every((term) => words.some((word) => word.startsWith(term))) ||
      view.title.toLowerCase().includes(needle)
    )
  })
  const project = projectDisplayName(
    repository,
    target.projectId ? 'Unavailable project' : 'All projects',
  )
  const computer = target.environmentId ? (source?.name ?? 'Unavailable computer') : 'All machines'
  const activeView = views.find((view) => view.id === activeId)
  const inherited = activeView?.settingsScope === 'inherited'
  const mixed = mixedPages.has(activeId)
  const scopeLabel = pageStorage(activeView)?.label ?? 'History on paired computers'
  const [sidebarVisible] = useLeftSidebar()
  return (
    <nav
      style={sidebarVisible ? undefined : { display: 'none' }}
      aria-label="Settings sections"
      className="studio-side-panel flex min-h-0 shrink-0 flex-col border-b bg-sidebar/60 px-4 py-3 md:w-52 md:gap-3 md:overflow-hidden md:border-b-0 md:border-r md:px-3 md:py-4 lg:w-64"
    >
      <SidebarHeader />
      <div className="md:hidden">
        <Select value={activeId} onValueChange={select}>
          <SelectTrigger aria-label="Settings section" className="h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {headings.map(([section, label]) => {
              const items = ordered.filter((view) => sectionFor(view) === section)
              if (!items.length) return null
              return (
                <SelectGroup key={section}>
                  <SelectLabel className="text-xs text-muted-foreground">{label}</SelectLabel>
                  {items.map((view) => (
                    <SelectItem key={view.id} value={view.id}>
                      {view.title}
                    </SelectItem>
                  ))}
                </SelectGroup>
              )
            })}
          </SelectContent>
        </Select>
        <p className="mt-2 text-xs text-muted-foreground">{scopeLabel}</p>
      </div>
      <div className="hidden shrink-0 px-1 md:block">
        <h1 className="mb-2 px-1 text-base font-semibold tracking-tight">Settings</h1>
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
            className="h-9 rounded-md border-border/70 bg-background/70 pl-8 pr-8"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear settings search"
              onClick={() => setQuery('')}
              className="absolute right-1 top-1 rounded p-1.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>
      <div
        role="region"
        aria-label="Settings navigation"
        tabIndex={0}
        className="hidden min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring md:flex"
      >
        {headings.map(([section, label]) => {
          const items = matches.filter((view) => sectionFor(view) === section)
          if (!items.length) return null
          return (
            <div key={section} className="hidden text-sm md:block">
              <h2 className="flex min-h-8 items-center px-2 text-[0.8125rem] font-semibold text-foreground/90">
                {label}
              </h2>
              <div className="ml-3 space-y-0.5 border-l border-border/70 pl-1">
                {items.map((view) => {
                  const Icon = icons[view.id] ?? Settings2
                  const active = activeId === view.id
                  const placement = pageStorage(view)
                  const Storage = placement?.icon
                  const label = placement?.label
                  return (
                    <button
                      key={view.id}
                      type="button"
                      aria-current={active ? 'page' : undefined}
                      aria-label={view.title}
                      title={label ? `${view.title} · ${label}` : view.title}
                      onClick={() => select(view.id)}
                      className={`group flex min-h-8 w-full items-center gap-2 rounded-lg px-2 text-left text-[0.8125rem] transition-colors ${
                        active
                          ? 'bg-accent/70 font-medium text-foreground'
                          : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                      }`}
                    >
                      <Icon
                        size={16}
                        strokeWidth={1.7}
                        aria-hidden="true"
                        className={`shrink-0 ${active ? 'text-primary' : 'text-muted-foreground/70'}`}
                      />
                      <span className="min-w-0 flex-1 py-1 leading-snug">
                        <span className="block break-words">{view.title}</span>
                        {active && Storage && label && (
                          <span className="mt-0.5 flex min-w-0 items-center gap-1 break-words text-[11px] font-normal text-muted-foreground">
                            <Storage size={10} aria-hidden="true" className="shrink-0" />
                            {label}
                          </span>
                        )}
                      </span>
                      {active && (
                        <ChevronRight
                          size={13}
                          aria-hidden="true"
                          className="text-muted-foreground"
                        />
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
        {!matches.length && (
          <p role="status" className="hidden px-2 text-xs text-muted-foreground md:block">
            No settings match “{query}”.
          </p>
        )}
      </div>
      <aside
        aria-label={inherited ? 'Inherited settings target' : 'Settings storage'}
        className="hidden shrink-0 space-y-2 border-t px-2 pt-3 text-[11px] leading-relaxed text-muted-foreground md:block"
      >
        <p className="font-medium">
          {inherited ? `Current scope: ${settingsScopeLabels[scope]}` : scopeLabel}
        </p>
        {inherited && (
          <p className="break-words font-medium text-foreground [overflow-wrap:anywhere]">
            {project} · {computer}
          </p>
        )}
        <p>
          {activeId === 'usage'
            ? 'Usage and account limits come from paired computers. Choose a computer on this page to filter them.'
            : !activeView?.settingsScope
              ? 'Browse archived tasks from paired computers and restore them when needed.'
              : inherited
                ? 'Choose where defaults apply at the top of the page.'
                : mixed
                  ? 'App preferences stay on this device. Computer settings use the computer selected on this page.'
                  : activeView?.settingsScope === 'device'
                    ? 'Saved automatically on this device.'
                    : 'Each page shows the computer it uses. Changes are shared with its paired devices.'}
        </p>
      </aside>
    </nav>
  )
}
