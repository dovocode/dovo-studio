import { useState } from 'react'
import {
  Settings,
  Bot,
  CircleDot,
  GitBranch,
  GitPullRequest,
  LayoutDashboard,
  ListChecks,
  MonitorSmartphone,
  MessagesSquare,
  Workflow,
  Download,
  RefreshCw,
  PanelsTopLeft,
} from 'lucide-react'
import type { DesktopUpdateState, DesktopUpdateChannel } from '@dovo/protocol'
import type { StudioIcon, StudioView } from '@dovo/studio-core'
import { Button, Popover, Tooltip, TooltipContent, TooltipTrigger, cn } from '@dovo/studio-ui'

const size = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`

const icons: Record<StudioIcon, typeof Bot> = {
  tasks: MessagesSquare,
  issues: CircleDot,
  jira: PanelsTopLeft,
  scm: GitBranch,
  pulls: GitPullRequest,
  pipelines: ListChecks,
  agents: Bot,
  jobs: Workflow,
  runtime: MonitorSmartphone,
}

export function ActivityBar({
  taskHeader = false,
  views,
  activeId,
  onSelect,
  update,
  onUpdate,
  onCheckUpdates,
  onUpdateChannel,
}: {
  taskHeader?: boolean
  views: readonly StudioView[]
  activeId: string
  onSelect: (id: string) => void
  update?: DesktopUpdateState
  onUpdate?: () => void
  onCheckUpdates?: () => void
  onUpdateChannel?: (channel: DesktopUpdateChannel) => Promise<void>
}) {
  const [changingChannel, setChangingChannel] = useState(false)
  const [channelError, setChannelError] = useState('')
  const settings = views.filter((view) => view.navigationGroup === 'settings')
  const settingsActive = settings.some((view) => view.id === activeId)
  const item = (
    id: string,
    label: string,
    Icon: typeof Bot,
    selected: boolean,
    select: () => void,
  ) => (
    <Tooltip key={id}>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          aria-current={selected ? 'page' : undefined}
          className={cn('studio-navigation-item', selected && 'is-active')}
          onClick={select}
        >
          <Icon size={18} strokeWidth={1.7} aria-hidden="true" />
          <span className="studio-navigation-label">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={10}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
  return (
    <nav className="studio-navigation" aria-label="Main navigation">
      {taskHeader && <div className="studio-task-rail-header" aria-hidden="true" />}
      <span className="studio-navigation-heading" aria-hidden="true">
        Workspace
      </span>
      {item('overview', 'Overview', LayoutDashboard, activeId === 'overview', () =>
        onSelect('overview'),
      )}
      {views
        .filter((view) => !view.navigationGroup)
        .map((view) =>
          item(view.id, view.title, icons[view.icon], activeId === view.id, () =>
            onSelect(view.id),
          ),
        )}
      <div className="studio-navigation-settings">
        {onCheckUpdates && (
          <Popover.Root>
            <Popover.Trigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label="Check for Updates"
                className="studio-navigation-item"
              >
                <RefreshCw size={18} strokeWidth={1.7} aria-hidden="true" />
                <span className="studio-navigation-label">Check for Updates</span>
              </Button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                side="right"
                sideOffset={10}
                className="z-50 w-64 rounded-lg border bg-popover p-4 text-popover-foreground shadow-lg"
                aria-label="Update settings"
              >
                <h2 className="text-sm font-semibold">Check for Updates</h2>
                {!!onUpdateChannel && (
                  <label className="mt-3 block text-xs">
                    Release channel
                    <select
                      className="mt-1 w-full rounded-md border bg-background p-2 text-sm"
                      value={update?.channel ?? 'stable'}
                      disabled={
                        changingChannel ||
                        ['downloading', 'downloaded', 'restarting'].includes(update?.status ?? '')
                      }
                      onChange={(event) => {
                        const channel = event.target.value
                        if (channel !== 'stable' && channel !== 'nightly') return
                        setChangingChannel(true)
                        setChannelError('')
                        void onUpdateChannel(channel)
                          .catch((error: unknown) => {
                            setChannelError(error instanceof Error ? error.message : String(error))
                          })
                          .finally(() => setChangingChannel(false))
                      }}
                    >
                      <option value="stable">Stable</option>
                      <option value="nightly">Nightly</option>
                    </select>
                  </label>
                )}
                <p className="mt-2 text-xs text-muted-foreground">
                  Nightly includes the newest changes and may be less stable.
                </p>
                {!!channelError && (
                  <p role="alert" className="mt-2 text-xs text-destructive">
                    {channelError}
                  </p>
                )}
                <Button
                  className="mt-3 w-full"
                  size="sm"
                  disabled={changingChannel}
                  onClick={onCheckUpdates}
                >
                  {changingChannel ? 'Checking…' : 'Check updates'}
                </Button>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        )}
        {!!onUpdate && !!update && update.status !== 'idle' && update.status !== 'error' && (
          <Popover.Root>
            <Popover.Trigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Update ${update.version ?? ''}: ${update.status === 'downloading' ? `downloading ${Math.round(update.progress ?? 0)}%` : update.status === 'downloaded' ? 'ready to install' : update.status === 'restarting' ? 'restarting' : 'available'}`}
                className="studio-navigation-item studio-update-item"
              >
                <Download size={18} strokeWidth={1.7} aria-hidden="true" />
                <span className="studio-update-dot" />
                {update.status === 'downloading' && (
                  <span
                    className="studio-update-progress"
                    style={{ width: `${Math.min(100, Math.max(0, update.progress ?? 0))}%` }}
                  />
                )}
              </Button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content
                side="right"
                sideOffset={10}
                className="z-50 w-80 max-w-[calc(100vw-4rem)] rounded-lg border bg-popover p-4 text-popover-foreground shadow-lg"
                aria-label="Desktop update"
              >
                <h2 className="text-sm font-semibold">Dovo Studio {update.version}</h2>
                <p className="mt-1 text-xs text-muted-foreground">What’s new in this update</p>
                <div className="mt-2 max-h-56 overflow-y-auto whitespace-pre-wrap text-xs leading-5">
                  {update.notes ?? 'Release notes are unavailable.'}
                </div>
                {update.status === 'downloading' && (
                  <div className="mt-4" role="status" aria-live="polite">
                    <div className="flex justify-between text-xs">
                      <span>Downloading {Math.round(update.progress ?? 0)}%</span>
                      {update.total && (
                        <span>
                          {size(update.transferred ?? 0)} / {size(update.total)}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-primary"
                        style={{ width: `${Math.min(100, Math.max(0, update.progress ?? 0))}%` }}
                      />
                    </div>
                    {!!update.bytesPerSecond && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {size(update.bytesPerSecond)}/s
                      </p>
                    )}
                  </div>
                )}
                {update.status === 'restarting' && (
                  <p className="mt-4 text-xs">Preparing to restart…</p>
                )}
                {(update.status === 'available' || update.status === 'downloaded') && (
                  <Button className="mt-4 w-full" size="sm" onClick={onUpdate}>
                    {update.status === 'downloaded' ? 'Restart and install' : 'Download'}
                  </Button>
                )}
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        )}
        {!!settings.length &&
          item('settings', 'Settings', Settings, settingsActive, () => onSelect(settings[0].id))}
      </div>
    </nav>
  )
}
