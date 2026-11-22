import { useLayoutEffect, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { Check, ChevronRight, Plus, X } from 'lucide-react'
import { DropdownMenu, IconButton, cn } from '@dovo/studio-ui'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import type { TaskSurface } from './task-header'
import { RightPaneTabIcon } from './tool-icons'

const labels = {
  changes: 'Changes',
  files: 'Files',
  browser: 'Browser',
  terminal: 'Terminal',
  'side-chats': 'Side chats',
  'linked-pulls': 'Linked PRs',
  'pull-preview': 'Pull request',
  agents: 'Agents',
  projects: 'Linked projects',
  devices: 'Devices',
  artifacts: 'Artifacts',
  'bot-settings': 'Bot settings',
  'bot-mcp': 'MCP servers',
  'bot-skills': 'Skills',
  'bot-memory': 'Memory',
  'bot-routines': 'Routines',
} satisfies Record<Exclude<TaskSurface, 'chat'>, string>

export type RightPaneTab = keyof typeof labels
export const rightPaneTabsToAdd = [
  'changes',
  'files',
  'browser',
  'terminal',
  'side-chats',
] as const satisfies readonly RightPaneTab[]

function isRightPaneTab(value: unknown): value is RightPaneTab {
  return typeof value === 'string' && Object.hasOwn(labels, value)
}

export function reorderRightPaneTabs(
  tabs: readonly RightPaneTab[],
  from: RightPaneTab,
  to: RightPaneTab,
) {
  const source = tabs.indexOf(from)
  const destination = tabs.indexOf(to)
  if (source === -1 || destination === -1 || source === destination) return tabs
  const reordered = tabs.filter((tab) => tab !== from)
  reordered.splice(destination, 0, from)
  return reordered
}

export type RightPaneFile = { path: string; line?: number; checkoutId?: string }
type RightPaneLayout = {
  tabs: readonly RightPaneTab[]
  active: TaskSurface
  file?: RightPaneFile
  width?: number
  sideThread?: string
}

function layoutKey(key: string) {
  return `dovo.thread-right-pane.v1:${key}`
}

export function readRightPaneLayout(key: string): RightPaneLayout {
  try {
    const saved: unknown = JSON.parse(sessionStorage.getItem(layoutKey(key)) ?? 'null')
    if (saved && typeof saved === 'object' && 'tabs' in saved && Array.isArray(saved.tabs)) {
      const tabs = [...new Set(saved.tabs.filter(isRightPaneTab))]
      const active = 'active' in saved ? saved.active : undefined
      const file = 'file' in saved ? saved.file : undefined
      return {
        tabs,
        active: isRightPaneTab(active) && tabs.includes(active) ? active : 'chat',
        sideThread:
          'sideThread' in saved && typeof saved.sideThread === 'string'
            ? saved.sideThread
            : undefined,
        width:
          'width' in saved && typeof saved.width === 'number' && Number.isFinite(saved.width)
            ? saved.width
            : undefined,
        file:
          file && typeof file === 'object' && 'path' in file && typeof file.path === 'string'
            ? {
                path: file.path,
                line: 'line' in file && typeof file.line === 'number' ? file.line : undefined,
                checkoutId:
                  'checkoutId' in file && typeof file.checkoutId === 'string'
                    ? file.checkoutId
                    : undefined,
              }
            : undefined,
      }
    }
  } catch {
    // Storage can be disabled. Keep the pane usable for the current view.
  }
  return { tabs: [], active: 'chat' }
}

export function saveRightPaneLayout(key: string, layout: RightPaneLayout) {
  try {
    sessionStorage.setItem(layoutKey(key), JSON.stringify(layout))
  } catch {
    // Storage can be disabled or full.
  }
}

export function RightPaneTabs({
  tabs,
  active,
  addable,
  panelId,
  detail,
  detailTitle,
  actionsRef,
  onSelect,
  onAdd,
  onDevTools,
  onClose,
  onReorder,
  onHide,
  tabLabels,
}: {
  tabs: readonly RightPaneTab[]
  active: RightPaneTab
  addable: readonly RightPaneTab[]
  panelId: string
  detail?: string
  detailTitle?: string
  actionsRef?: (element: HTMLDivElement | null) => void
  onSelect: (tab: RightPaneTab) => void
  onAdd: (tab: RightPaneTab) => void
  onDevTools?: () => void
  onClose: (tab: RightPaneTab) => void
  onReorder: (from: RightPaneTab, to: RightPaneTab) => void
  onHide: () => void
  tabLabels?: Partial<Record<RightPaneTab, string>>
}) {
  const uiText = useInterfaceText()
  const rail = useRef<HTMLDivElement>(null)
  const buttons = useRef<Partial<Record<RightPaneTab, HTMLButtonElement>>>({})
  const dragging = useRef<RightPaneTab | null>(null)
  const reorderFocus = useRef<RightPaneTab | null>(null)
  useLayoutEffect(() => {
    const element = rail.current
    const button = buttons.current[active]
    const tab = button?.parentElement
    if (reorderFocus.current) {
      buttons.current[reorderFocus.current]?.focus({ preventScroll: true })
      reorderFocus.current = null
    }
    if (!element || !tab) return
    const viewport = element.getBoundingClientRect()
    const bounds = tab.getBoundingClientRect()
    if (bounds.left < viewport.left) element.scrollLeft += bounds.left - viewport.left
    else if (bounds.right > viewport.right) element.scrollLeft += bounds.right - viewport.right
  }, [active, tabs])
  const focusTab = (tab: RightPaneTab) => buttons.current[tab]?.focus()
  const select = (tab: RightPaneTab) => {
    onSelect(tab)
    focusTab(tab)
  }
  const close = (tab: RightPaneTab) => {
    if (tab === active) {
      const index = tabs.indexOf(tab)
      const adjacent = tabs[index + 1] ?? tabs[index - 1]
      if (adjacent) focusTab(adjacent)
    } else focusTab(active)
    onClose(tab)
  }
  const keyboard = (event: KeyboardEvent<HTMLButtonElement>, tab: RightPaneTab) => {
    const index = tabs.indexOf(tab)
    if (event.key === 'Delete') {
      event.preventDefault()
      close(tab)
      return
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      const destination = event.key === 'Home' ? tabs[0] : tabs.at(-1)
      if (destination) select(destination)
      return
    }
    const offset = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
    if (!offset) return
    event.preventDefault()
    if ((event.ctrlKey || event.metaKey) && event.shiftKey) {
      const adjacent = tabs[index + offset]
      if (adjacent) {
        reorderFocus.current = tab
        onReorder(tab, adjacent)
      }
      return
    }
    select(tabs[(index + tabs.length + offset) % tabs.length])
  }
  return (
    <div className="studio-pane-header flex min-w-0 shrink-0 items-center gap-1">
      <div
        ref={rail}
        aria-label={uiText('Right pane tabs')}
        role="tablist"
        className="flex min-w-0 items-center gap-1 overflow-x-auto"
      >
        {tabs.map((tab) => (
          <div
            key={tab}
            data-active={tab === active || undefined}
            className="studio-pane-tab flex shrink-0 items-center rounded-lg"
            draggable
            onDragStart={(event) => {
              dragging.current = tab
              event.dataTransfer.setData('text/plain', tab)
              event.dataTransfer.effectAllowed = 'move'
            }}
            onDragEnd={() => {
              dragging.current = null
            }}
            onDragOver={(event) => {
              if (dragging.current && dragging.current !== tab) event.preventDefault()
            }}
            onDrop={(event) => {
              if (!dragging.current) return
              event.preventDefault()
              onReorder(dragging.current, tab)
              dragging.current = null
            }}
          >
            <button
              ref={(element) => {
                if (element) buttons.current[tab] = element
                else delete buttons.current[tab]
              }}
              type="button"
              id={`${panelId}-${tab}`}
              role="tab"
              aria-selected={tab === active}
              aria-keyshortcuts="Delete Control+Shift+ArrowLeft Control+Shift+ArrowRight"
              aria-controls={panelId}
              tabIndex={tab === active ? 0 : -1}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2 py-1 text-xs outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring',
                tab === active
                  ? 'font-medium text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
              onClick={() => select(tab)}
              onKeyDown={(event) => keyboard(event, tab)}
              title={uiText(tabLabels?.[tab] ?? labels[tab])}
            >
              <RightPaneTabIcon tab={tab} />
              {uiText(tabLabels?.[tab] ?? labels[tab])}
            </button>
            <IconButton
              label={uiText('Close {value0} tab', {
                value0: uiText(tabLabels?.[tab] ?? labels[tab]),
              })}
              className={cn('size-5 shrink-0', tab !== active && 'studio-tab-reveal')}
              tabIndex={-1}
              onClick={() => close(tab)}
            >
              <X size={12} />
            </IconButton>
          </div>
        ))}
      </div>
      {detail && (
        <span
          className="flex min-w-0 flex-1 items-center gap-1 px-1 text-xs text-muted-foreground"
          title={detailTitle}
        >
          <ChevronRight size={12} className="shrink-0 opacity-60" aria-hidden="true" />
          <span className="min-w-0 truncate text-foreground">{detail}</span>
        </span>
      )}
      <PaneAddMenu
        label="Add pane tab"
        addable={addable}
        onAdd={onAdd}
        onDevTools={onDevTools}
        tabLabels={tabLabels}
      />
      {!detail && <span className="studio-pane-shoulder" aria-hidden="true" />}
      {actionsRef && <div ref={actionsRef} className="flex shrink-0 items-center" />}
      <IconButton label={uiText('Hide right pane')} className="size-7 shrink-0" onClick={onHide}>
        <X size={14} />
      </IconButton>
    </div>
  )
}

export function PaneAddMenu({
  label,
  icon,
  addable,
  open = [],
  onAdd,
  onDevTools,
  onNewThread,
  actions = [],
  tabLabels,
}: {
  label: string
  icon?: ReactNode
  addable: readonly RightPaneTab[]
  /** Tools that already have a pane tab. Choosing one shows that tab again. */
  open?: readonly RightPaneTab[]
  onAdd?: (tab: RightPaneTab) => void
  onDevTools?: () => void
  onNewThread?: () => void
  actions?: readonly { label: string; onSelect: () => void }[]
  tabLabels?: Partial<Record<RightPaneTab, string>>
}) {
  const uiText = useInterfaceText()
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <IconButton
          label={uiText(label)}
          className="size-7 shrink-0"
          disabled={!addable.length && !onDevTools && !onNewThread && !actions.length}
        >
          {icon ?? <Plus size={15} />}
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={5}
          className="studio-menu-surface z-50 min-w-32 rounded-xl border bg-popover p-1 text-xs text-popover-foreground"
        >
          {onNewThread && (
            <DropdownMenu.Item
              className="cursor-default rounded-md px-2 py-1.5 outline-none focus:bg-accent"
              onSelect={onNewThread}
            >
              {uiText('New thread')}
            </DropdownMenu.Item>
          )}
          {addable.map((tab) => (
            <DropdownMenu.Item
              key={tab}
              // Keep the tool name stable for assistive technology and announce the tab state.
              aria-label={uiText(tabLabels?.[tab] ?? labels[tab])}
              aria-description={open.includes(tab) ? uiText('Open') : undefined}
              className="flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 outline-none focus:bg-accent"
              onSelect={() => onAdd?.(tab)}
            >
              <span className="text-muted-foreground">
                <RightPaneTabIcon tab={tab} size={14} />
              </span>
              <span className="min-w-0 flex-1 truncate">
                {uiText(tabLabels?.[tab] ?? labels[tab])}
              </span>
              {open.includes(tab) && (
                <span
                  aria-hidden="true"
                  className="flex shrink-0 items-center gap-1 text-[0.6875rem] text-muted-foreground"
                >
                  <Check size={12} aria-hidden="true" />
                  {uiText('Open')}
                </span>
              )}
            </DropdownMenu.Item>
          ))}
          {actions.map(({ label, onSelect }) => (
            <DropdownMenu.Item
              key={label}
              className="cursor-default rounded-md px-2 py-1.5 outline-none focus:bg-accent"
              onSelect={onSelect}
            >
              {uiText(label)}
            </DropdownMenu.Item>
          ))}
          {onDevTools && (
            <DropdownMenu.Item
              className="cursor-default rounded-md px-2 py-1.5 outline-none focus:bg-accent"
              onSelect={onDevTools}
            >
              {uiText('DevTools')}
            </DropdownMenu.Item>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
