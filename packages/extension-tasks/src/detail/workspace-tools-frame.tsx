import { lazy, Suspense, useEffect, useId, useState, type ReactNode } from 'react'
import { Wrench } from 'lucide-react'
import {
  randomUUID,
  STUDIO_BROWSER_SCOPE,
  type ChangedFile,
  type RuntimeProfile,
} from '@dovo/protocol'
import { responses, useStudioHost, useWorkspace, WorkspaceScope } from '@dovo/studio-core'
import { Button, cn } from '@dovo/studio-ui'
import {
  PaneAddMenu,
  RightPaneTabs,
  readRightPaneLayout,
  reorderRightPaneTabs,
  saveRightPaneLayout,
  type RightPaneTab,
} from './right-pane-tabs'
import { ResizableSidebar } from './resizable-sidebar'

const Browser = lazy(() =>
  import('../browser/browser-pane').then(({ BrowserPane }) => ({ default: BrowserPane })),
)
const CheckpointDiff = lazy(() =>
  import('../files/saved-file-diff').then(({ CheckpointDiff }) => ({ default: CheckpointDiff })),
)

function CheckoutChanges({ repositoryId }: { repositoryId: string }) {
  const { connected, request } = useWorkspace()
  const [files, setFiles] = useState<ChangedFile[]>()
  const [selected, setSelected] = useState('')
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (!connected) return
    let current = true
    setError('')
    void request('/api/scm/changes', { repositoryId }, responses.files).then(
      (response) => {
        if (current) setFiles(response.files)
      },
      (cause: unknown) => {
        if (current) setError(cause instanceof Error ? cause.message : String(cause))
      },
    )
    return () => {
      current = false
    }
  }, [attempt, connected, repositoryId, request])
  const file = files?.find((item) => item.path === selected) ?? files?.[0]
  return (
    <div className="min-h-0 flex-1 overflow-auto p-3 text-sm">
      <div className="flex items-center gap-2">
        {file && (
          <select
            aria-label="Changed file"
            className="min-w-0 flex-1 rounded border bg-background px-2 py-1"
            value={file.path}
            onChange={(event) => setSelected(event.target.value)}
          >
            {files?.map((item) => (
              <option key={item.path}>{item.path}</option>
            ))}
          </select>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={!connected}
          onClick={() => setAttempt((value) => value + 1)}
        >
          Refresh
        </Button>
      </div>
      {!connected && (
        <p role="status" className="text-muted-foreground">
          Reconnect to refresh checkout changes.
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive">
          {error}
        </p>
      )}
      {file ? (
        <CheckpointDiff file={file} />
      ) : (
        connected &&
        !error && (
          <p role="status" className="text-muted-foreground">
            {files ? 'No working tree changes.' : 'Loading changes…'}
          </p>
        )
      )}
    </div>
  )
}

export function WorkspaceToolsFrame({
  scope,
  checkout,
  visible = true,
  children,
}: {
  scope: string
  checkout?: { repositoryId: string; profile: RuntimeProfile }
  visible?: boolean
  children: (tools: ReactNode) => ReactNode
}) {
  const host = useStudioHost()
  const panelId = useId()
  const key = `workspace:${scope}`
  const [layout, setLayout] = useState(() => readRightPaneLayout(key))
  const [devTools, setDevTools] = useState<string | undefined>()
  const available: readonly RightPaneTab[] = checkout ? ['browser', 'changes'] : ['browser']
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
              onAdd={select}
              onDevTools={openDevTools}
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
                  devToolsRequest={
                    devTools ? { id: devTools, onHandled: () => setDevTools(undefined) } : undefined
                  }
                />
              ) : (
                checkout && (
                  <WorkspaceScope profile={checkout.profile}>
                    <CheckoutChanges
                      key={checkout.repositoryId}
                      repositoryId={checkout.repositoryId}
                    />
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
