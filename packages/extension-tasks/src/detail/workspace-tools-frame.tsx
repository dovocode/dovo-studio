import { lazy, Suspense, useEffect, useId, useState, type ReactNode } from 'react'
import { Wrench } from 'lucide-react'
import {
  randomUUID,
  STUDIO_BROWSER_SCOPE,
  STUDIO_TERMINAL_SCOPE,
  type RuntimeProfile,
} from '@dovo/protocol'
import { useStudioHost, WorkspaceScope } from '@dovo/studio-core'
import { cn } from '@dovo/studio-ui'
import {
  PaneAddMenu,
  RightPaneTabs,
  readRightPaneLayout,
  reorderRightPaneTabs,
  saveRightPaneLayout,
  type RightPaneTab,
} from './right-pane-tabs'
import { ResizableSidebar } from './resizable-sidebar'
import { TerminalWorkspaceFiles } from '../terminal/terminal-workspace-files'

const Browser = lazy(() =>
  import('../browser/browser-pane').then(({ BrowserPane }) => ({ default: BrowserPane })),
)
const Devices = lazy(() =>
  import('../browser/browser-pane').then(({ DevicesPane }) => ({ default: DevicesPane })),
)
const SideThread = lazy(() =>
  import('../browser/browser-thread-panel').then(({ BrowserThreadPanel }) => ({
    default: BrowserThreadPanel,
  })),
)
const CheckoutChanges = lazy(() =>
  import('./checkout-changes').then(({ CheckoutChanges }) => ({ default: CheckoutChanges })),
)

export function WorkspaceToolsFrame({
  scope,
  terminal,
  visible = true,
  children,
}: {
  scope: string
  terminal?: {
    id: string
    profile: RuntimeProfile
    supported: boolean
    project?: { repositoryId: string; git: boolean; main: boolean; worktree?: string }
  }
  visible?: boolean
  children: (tools: ReactNode) => ReactNode
}) {
  const host = useStudioHost()
  const panelId = useId()
  const key = `workspace:${scope}`
  const [layout, setLayout] = useState(() => readRightPaneLayout(key))
  const [devTools, setDevTools] = useState<string | undefined>()
  const [browserLink, setBrowserLink] = useState<{ id: string; url: string } | null>(null)
  // The open changed file belongs to one checkout. Another project, worktree or endpoint starts
  // again, so a path with the same name in a different checkout is never reused.
  const changesScope = terminal?.project
    ? JSON.stringify([
        terminal.profile.id,
        terminal.id,
        terminal.project.repositoryId,
        terminal.project.worktree ?? '',
        terminal.supported,
      ])
    : ''
  const [changedFile, setChangedFile] = useState({ scope: '', path: '' })
  const available: RightPaneTab[] = ['browser']
  if (terminal) {
    available.push('side-chats', 'devices')
    if (terminal.project) available.push('files')
    if (terminal.project?.git && (terminal.supported || terminal.project.main))
      available.push('changes')
  }
  const labels = terminal ? { 'side-chats': 'Side thread' } : undefined
  const tabs = layout.tabs.filter((tab) => available.includes(tab))
  const active =
    layout.active !== 'chat' && tabs.includes(layout.active) ? layout.active : undefined
  const select = (tab: RightPaneTab) =>
    setLayout((current) => ({
      ...current,
      active: tab,
      tabs: current.tabs.includes(tab) ? current.tabs : [...current.tabs, tab],
    }))
  const close = (tab: RightPaneTab) =>
    setLayout((current) => {
      const remaining = tabs.filter((item) => item !== tab)
      const index = tabs.indexOf(tab)
      return {
        ...current,
        tabs: remaining,
        active:
          current.active === tab
            ? (remaining[index] ?? remaining[index - 1] ?? 'chat')
            : current.active,
      }
    })
  const openDevTools = host.browser
    ? () => {
        setDevTools(randomUUID())
        select('browser')
      }
    : undefined
  useEffect(() => saveRightPaneLayout(key, layout), [key, layout])
  return (
    <div
      className={cn('studio-thread-pane-body flex min-h-0 min-w-0 flex-1', !visible && 'hidden')}
      hidden={!visible}
    >
      <div className="studio-workspace-tools-main flex min-h-0 min-w-0 flex-1 flex-col">
        {children(
          <span className="hidden md:inline-flex">
            <PaneAddMenu
              label="Workspace tools"
              icon={<Wrench size={15} />}
              addable={available}
              open={tabs}
              onAdd={select}
              onDevTools={openDevTools}
              tabLabels={labels}
            />
          </span>,
        )}
      </div>
      {visible && active && (
        <ResizableSidebar
          preference="toolsSidebarWidth"
          side="right"
          maxFraction={0.6}
          maxWidth={960}
          savedWidth={layout.width}
          onWidthCommit={(width) => setLayout((current) => ({ ...current, width }))}
          label="tools sidebar"
          aria-label="Workspace tools"
          className="studio-thread-tools-panel hidden min-h-0 flex-col md:flex"
        >
          <RightPaneTabs
            tabs={tabs}
            active={active}
            addable={available.filter((tab) => !tabs.includes(tab))}
            panelId={panelId}
            onSelect={select}
            onAdd={select}
            onDevTools={openDevTools}
            tabLabels={labels}
            onHide={() => setLayout((current) => ({ ...current, active: 'chat' }))}
            onClose={close}
            onReorder={(from, to) =>
              setLayout((current) => ({ ...current, tabs: reorderRightPaneTabs(tabs, from, to) }))
            }
          />
          <div
            id={panelId}
            role="tabpanel"
            aria-labelledby={`${panelId}-${active}`}
            className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[inherit]"
          >
            <Suspense fallback={<p className="p-3 text-xs text-muted-foreground">Loading tool…</p>}>
              {active === 'browser' ? (
                <Browser
                  taskId={STUDIO_BROWSER_SCOPE}
                  paneScope={scope}
                  openLink={browserLink}
                  onLinkOpened={() => setBrowserLink(null)}
                  devToolsRequest={
                    devTools ? { id: devTools, onHandled: () => setDevTools(undefined) } : undefined
                  }
                />
              ) : terminal && active === 'side-chats' ? (
                <SideThread
                  runtimeId={terminal.profile.id}
                  terminal={terminal.project ?? {}}
                  thread={
                    layout.sideThread
                      ? { id: layout.sideThread, runtimeId: terminal.profile.id }
                      : undefined
                  }
                  onThread={(thread) =>
                    setLayout((current) => ({ ...current, sideThread: thread.id }))
                  }
                  onBrowser={(url) => {
                    setBrowserLink({ id: randomUUID(), url })
                    select('browser')
                  }}
                />
              ) : (
                terminal && (
                  <WorkspaceScope profile={terminal.profile}>
                    {active === 'changes' && terminal.project ? (
                      <CheckoutChanges
                        key={changesScope}
                        repositoryId={terminal.project.repositoryId}
                        terminalId={terminal.supported ? terminal.id : undefined}
                        selected={changedFile.scope === changesScope ? changedFile.path : ''}
                        onSelect={(path) => setChangedFile({ scope: changesScope, path })}
                      />
                    ) : !terminal.supported ? (
                      <p role="status" className="p-3 text-xs text-muted-foreground">
                        Update the terminal’s computer to use this tool.
                      </p>
                    ) : active === 'files' ? (
                      <TerminalWorkspaceFiles terminalId={terminal.id} />
                    ) : (
                      active === 'devices' && <Devices taskId={STUDIO_TERMINAL_SCOPE} />
                    )}
                  </WorkspaceScope>
                )
              )}
            </Suspense>
          </div>
        </ResizableSidebar>
      )}
    </div>
  )
}
