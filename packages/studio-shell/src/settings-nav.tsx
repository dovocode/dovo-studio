import { useEffect, useRef, useState } from 'react'
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
  Button,
  Popover,
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
  'task-behavior': ListTodo,
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

type NavigationSection = SettingsSection | 'more' | 'new-tasks' | 'running-tasks'
const headings: readonly [NavigationSection, string][] = [
  ['app', 'App preferences'],
  ['new-tasks', 'New task defaults'],
  ['running-tasks', 'Running task behavior'],
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

function storageDescription(view?: StudioView) {
  if (view?.id === 'usage')
    return 'Usage and account limits come from paired computers. Choose a computer on this page to filter them.'
  if (!view?.settingsScope)
    return 'Browse archived tasks from paired computers and restore them when needed.'
  if (view.settingsScope === 'inherited')
    return 'Choose where defaults apply at the top of the page.'
  if (mixedPages.has(view.id))
    return 'App preferences stay on this device. Computer settings use the computer selected on this page.'
  return view.settingsScope === 'device'
    ? 'Saved automatically on this device.'
    : 'Each page shows the computer it uses. Changes are shared with its paired devices.'
}

/** Grouped desktop settings navigation, with searchable categories and storage indicators. */
export function SettingsNav({
  views,
  activeId,
  onSelect,
}: {
  views: readonly StudioView[]
  activeId: string
  onSelect: (viewId: string) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const navigation = useRef<HTMLElement>(null)
  const [query, setQuery] = useApplicationState('')
  const [jump, setJump] = useState<{ viewId: string; label: string } | null>(null)
  const [searchStatus, setSearchStatus] = useState('')
  const { target, scope, source, repository } = useSettingsTarget()
  const clearSearch = () => {
    setQuery('')
    setJump(null)
    setSearchStatus('')
  }
  useEffect(() => {
    if (!jump) return
    if (jump.viewId !== activeId) {
      setJump(null)
      setSearchStatus('')
      return
    }
    const root = document.querySelector('[data-settings-content]')
    if (!root) return
    let highlighted: HTMLElement | undefined
    const reveal = () => {
      const candidates = root.querySelectorAll<HTMLElement>(
        '[data-setting-label], [aria-label], label, summary',
      )
      const element = [...candidates].find(
        (element) =>
          (element.dataset.settingLabel ??
            element.getAttribute('aria-label') ??
            element.textContent?.trim()) === jump.label,
      )
      if (!element) return false
      let parent = element.parentElement
      while (parent && parent !== root) {
        if (parent instanceof HTMLDetailsElement) parent.open = true
        parent = parent.parentElement
      }
      highlighted = element.closest<HTMLElement>('[data-setting-label]') ?? element
      highlighted.setAttribute('data-search-highlight', '')
      highlighted.classList.add('bg-accent')
      if (!highlighted.hasAttribute('tabindex')) highlighted.tabIndex = -1
      highlighted.focus({ preventScroll: true })
      highlighted.scrollIntoView({ block: 'center', behavior: 'instant' })
      setSearchStatus(`Showing ${jump.label}.`)
      return true
    }
    const observer = new MutationObserver(() => {
      if (reveal()) {
        observer.disconnect()
        clearTimeout(timeout)
      }
    })
    const unavailable = `${jump.label} is not shown for this target. ${views.find((view) => view.id === jump.viewId)?.settingsFieldRequirements?.[jump.label] ?? 'Choose another project, computer or agent on this page.'}`
    const timeout = window.setTimeout(() => observer.disconnect(), 15000)
    if (reveal()) clearTimeout(timeout)
    else {
      setSearchStatus(unavailable)
      observer.observe(root, { childList: true, subtree: true })
    }
    return () => {
      observer.disconnect()
      clearTimeout(timeout)
      highlighted?.removeAttribute('data-search-highlight')
      highlighted?.classList.remove('bg-accent')
    }
  }, [jump, activeId, target.environmentId, target.projectId])
  const select = (id: string) => {
    if (id !== activeId) onSelect(id)
  }
  const needle = query.trim().toLowerCase()
  const sectionFor = (view: StudioView): NavigationSection => {
    if (view.id === 'task-defaults') return 'new-tasks'
    if (
      view.id === 'task-behavior' ||
      view.id === 'running-tasks' ||
      view.id === 'pull-request-monitoring-settings'
    )
      return 'running-tasks'
    if (view.settingsScope === 'device') return 'app'
    return view.settingsSection ?? 'more'
  }
  const ordered = headings.flatMap(([section]) =>
    views.filter((view) => sectionFor(view) === section).sort((a, b) => a.order - b.order),
  )
  const fieldMatches = new Map(
    ordered.map((view) => [
      view.id,
      needle
        ? (view.settingsFields ?? []).filter(
            (label) =>
              needle.split(/\s+/).some((term) => label.toLowerCase().includes(term)) &&
              needle
                .split(/\s+/)
                .every((term) => `${label} ${view.title}`.toLowerCase().includes(term)),
          )
        : [],
    ]),
  )
  const matches = ordered.filter((view) => {
    if (!needle || fieldMatches.get(view.id)?.length) return true
    const category = headings.find(([section]) => section === sectionFor(view))?.[1] ?? ''
    const words = `${view.title} ${view.keywords ?? ''} ${category}`.toLowerCase().split(/\s+/)
    return (
      needle.split(/\s+/).every((term) => words.some((word) => word.startsWith(term))) ||
      view.title.toLowerCase().includes(needle)
    )
  })
  const openSetting = (viewId: string, label: string) => {
    setSearchStatus(`Opening ${label}…`)
    select(viewId)
    setJump({ viewId, label })
  }
  const firstField = ordered.flatMap((view) =>
    (fieldMatches.get(view.id) ?? []).map((label) => ({ viewId: view.id, label })),
  )[0]
  const resultCount =
    matches.length + [...fieldMatches.values()].reduce((count, fields) => count + fields.length, 0)
  const moveResult = (current: HTMLElement | null, direction: number) => {
    const results = [
      ...(navigation.current?.querySelectorAll<HTMLButtonElement>('[data-search-result]') ?? []),
    ]
    if (!results.length) return
    const index = results.findIndex((element) => element === current)
    results[(index + direction + results.length) % results.length]?.focus()
  }
  const project = projectDisplayName(
    repository,
    target.projectId ? 'Unavailable project' : 'All projects',
  )
  const computer = target.environmentId ? (source?.name ?? 'Unavailable computer') : 'All computers'
  const activeView = views.find((view) => view.id === activeId)
  const inherited = activeView?.settingsScope === 'inherited'
  const scopeLabel = pageStorage(activeView)?.label ?? 'History on paired computers'
  const [sidebarVisible] = useLeftSidebar()
  return (
    <nav
      ref={navigation}
      onKeyDown={(event) => {
        if (!needle || event.target === input.current) return
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault()
          moveResult(
            document.activeElement instanceof HTMLElement ? document.activeElement : null,
            event.key === 'ArrowDown' ? 1 : -1,
          )
        }
        if (event.key === 'Escape') {
          clearSearch()
          input.current?.focus()
        }
      }}
      style={sidebarVisible ? undefined : { display: 'none' }}
      aria-label="Settings sections"
      className="studio-side-panel flex min-h-0 shrink-0 flex-col border-b bg-sidebar px-4 py-3 md:w-52 md:gap-3 md:overflow-hidden md:border-b-0 md:border-r md:px-3 md:py-4 lg:w-64"
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
      <div className="shrink-0 px-1">
        <h1 className="mb-2 hidden px-1 text-base font-semibold tracking-tight md:block">
          Settings
        </h1>
        {/* Buttons and inputs inherit their font size (see studio-ui styles). */}
        <div className="relative text-[0.8125rem]">
          <Search
            aria-hidden="true"
            className="absolute left-2 top-2 size-3.5 text-muted-foreground"
          />
          <Input
            ref={input}
            aria-label="Search settings"
            placeholder="Search settings"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setJump(null)
              setSearchStatus('')
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                moveResult(null, event.key === 'ArrowDown' ? 1 : 0)
              }
              if (event.key === 'Enter') {
                if (firstField) openSetting(firstField.viewId, firstField.label)
                else if (matches[0]) select(matches[0].id)
              }
              if (event.key === 'Escape') clearSearch()
            }}
            className="h-9 rounded-lg border-border/60 bg-background/60 pl-8 pr-8"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear settings search"
              onClick={clearSearch}
              className="absolute right-1 top-1 rounded p-1.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>
      {needle && (
        <p role="status" className="px-2 text-xs text-muted-foreground">
          {resultCount} {resultCount === 1 ? 'result' : 'results'}
        </p>
      )}
      <div
        role="region"
        aria-label="Settings navigation"
        tabIndex={0}
        className={`${needle ? 'flex max-h-64 md:max-h-none' : 'hidden'} min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring md:flex`}
      >
        {headings.map(([section, label]) => {
          const items = matches.filter((view) => sectionFor(view) === section)
          if (!items.length) return null
          return (
            <div key={section} className="text-sm">
              <h2 className="flex min-h-8 items-center px-2 text-[0.8125rem] font-semibold text-foreground/90">
                {label}
              </h2>
              <div className="space-y-0.5">
                {items.map((view) => {
                  const Icon = icons[view.id] ?? Settings2
                  const active = activeId === view.id
                  const placement = pageStorage(view)
                  const Storage = placement?.icon
                  const label = placement?.label
                  return (
                    <div key={view.id}>
                      <div
                        className={`group flex min-h-8 w-full items-center gap-1 rounded-lg border border-transparent pr-1 text-[0.8125rem] transition-colors ${
                          active
                            ? 'border-primary/30 bg-[var(--studio-selected-fill)] font-medium text-foreground [background-image:var(--studio-selected-gradient)] [box-shadow:var(--studio-glow)]'
                            : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                        }`}
                      >
                        <button
                          type="button"
                          data-search-result
                          aria-current={active ? 'page' : undefined}
                          aria-label={view.title}
                          onClick={() => select(view.id)}
                          className="flex min-h-8 min-w-0 flex-1 items-center gap-2 rounded-lg py-1 pl-2 text-left"
                        >
                          <Icon
                            size={16}
                            strokeWidth={1.7}
                            aria-hidden="true"
                            className={`shrink-0 ${active ? 'text-primary' : 'text-muted-foreground/70'}`}
                          />
                          <span className="min-w-0 flex-1 break-words leading-snug">
                            {view.title}
                          </span>
                          {active && (
                            <ChevronRight
                              size={13}
                              aria-hidden="true"
                              className="shrink-0 text-muted-foreground"
                            />
                          )}
                        </button>
                        {Storage && label && (
                          <Popover.Root>
                            <Popover.Trigger asChild>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="size-7 shrink-0 p-0 text-muted-foreground"
                                aria-label={`Settings scope for ${view.title}`}
                                title={label}
                              >
                                <Storage size={13} aria-hidden="true" />
                              </Button>
                            </Popover.Trigger>
                            <Popover.Portal>
                              <Popover.Content
                                side="right"
                                align="start"
                                sideOffset={8}
                                className="studio-menu-surface z-50 w-72 max-w-[calc(100vw-24px)] space-y-2 rounded-lg border bg-popover p-3 text-xs text-popover-foreground"
                              >
                                <p className="font-semibold">
                                  {view.title} · {label}
                                </p>
                                {view.settingsScope === 'inherited' && (
                                  <>
                                    <p>Current scope: {settingsScopeLabels[scope]}</p>
                                    <p className="break-words font-medium [overflow-wrap:anywhere]">
                                      {project} · {computer}
                                    </p>
                                  </>
                                )}
                                <p className="text-muted-foreground">{storageDescription(view)}</p>
                              </Popover.Content>
                            </Popover.Portal>
                          </Popover.Root>
                        )}
                      </div>
                      {fieldMatches.get(view.id)?.map((label) => (
                        <button
                          key={label}
                          data-search-result
                          type="button"
                          onClick={() => openSetting(view.id, label)}
                          className="ml-3 block min-h-8 w-[calc(100%-0.75rem)] rounded-md px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {label}
                          {view.settingsFieldRequirements?.[label] && (
                            <span className="mt-0.5 block text-[11px]">
                              {view.settingsFieldRequirements[label]}
                            </span>
                          )}
                        </button>
                      ))}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}
        {!matches.length && (
          <p role="status" className="px-2 text-xs text-muted-foreground">
            No settings match “{query}”.
          </p>
        )}
      </div>
      {searchStatus && (
        <p role="status" className="px-2 text-xs text-muted-foreground">
          {searchStatus}
        </p>
      )}
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
      </aside>
    </nav>
  )
}
