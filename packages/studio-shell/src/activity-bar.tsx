import {
  Settings,
  Bot,
  CircleDot,
  GitBranch,
  GitPullRequest,
  ListChecks,
  MonitorSmartphone,
  MessagesSquare,
  Workflow,
  Download,
  RefreshCw,
  PanelsTopLeft,
  Shapes,
} from 'lucide-react'
import type { DesktopUpdateState } from '@dovo/protocol'
import type { StudioIcon, StudioView } from '@dovo/studio-core'
import {
  useNavigationSidebar,
  Button,
  MessageResponse,
  Popover,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from '@dovo/studio-ui'

const size = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MB`

const icons: Record<StudioIcon, typeof Bot> = {
  tasks: MessagesSquare,
  artifacts: Shapes,
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
  views,
  activeId,
  onSelect,
  update,
  onUpdate,
  onCheckUpdates,
}: {
  views: readonly StudioView[]
  activeId: string
  onSelect: (id: string) => void
  update?: DesktopUpdateState
  onUpdate?: () => void
  onCheckUpdates?: () => void
}) {
  const sidebar = useNavigationSidebar()
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
          aria-expanded={selected && sidebar?.collapsible ? !sidebar.collapsed : undefined}
          className={cn('studio-navigation-item', selected && 'is-active')}
          onClick={() =>
            selected && sidebar?.collapsible && sidebar.setCollapsed
              ? sidebar.setCollapsed((value) => !value)
              : select()
          }
        >
          <Icon size={18} strokeWidth={1.7} aria-hidden="true" />
          <span className="studio-navigation-label">{label}</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={10}>
        {selected && sidebar?.collapsible
          ? `${label} · ${sidebar.collapsed ? 'Show' : 'Hide'} sidebar`
          : label}
      </TooltipContent>
    </Tooltip>
  )
  return (
    <nav className="studio-navigation" aria-label="Main navigation">
      <span className="studio-navigation-heading" aria-hidden="true">
        Workspace
      </span>
      {views
        .filter((view) => !view.navigationGroup)
        .map((view) =>
          item(view.id, view.title, icons[view.icon], activeId === view.id, () =>
            onSelect(view.id),
          ),
        )}
      <div className="studio-navigation-settings">
        {(onCheckUpdates || onUpdate) && (
          <Popover.Root>
            <Popover.Trigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={
                  !update || ['idle', 'error'].includes(update.status)
                    ? 'Check for Updates'
                    : `Update ${update?.version ?? ''}: ${update?.status === 'downloading' ? `downloading ${Math.round(update?.progress ?? 0)}%` : update?.status === 'downloaded' ? 'ready to install' : update?.status === 'restarting' ? 'restarting' : 'available'}`
                }
                className="studio-navigation-item studio-update-item"
                data-update-available={
                  (update && !['idle', 'error'].includes(update.status)) || undefined
                }
              >
                {update && !['idle', 'error'].includes(update.status) ? (
                  <Download size={18} strokeWidth={1.7} aria-hidden="true" />
                ) : (
                  <RefreshCw size={18} strokeWidth={1.7} aria-hidden="true" />
                )}
                {update && !['idle', 'error'].includes(update.status) && (
                  <span className="studio-update-dot" />
                )}
                {update?.status === 'downloading' && (
                  <span
                    className="studio-update-progress"
                    style={{ width: `${Math.min(100, Math.max(0, update?.progress ?? 0))}%` }}
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
                <h2 className="text-sm font-semibold">Dovo Studio {update?.version}</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {update?.version
                    ? 'What’s new in this update'
                    : `Check the ${update?.channel === 'nightly' ? 'Nightly' : 'Stable'} channel. Change it in Settings → General → Updates.`}
                </p>
                {update?.version && (
                  <div className="mt-2 max-h-56 overflow-y-auto text-xs leading-5">
                    <MessageResponse
                      baseURL={`https://github.com/dovocode/dovo-studio/releases/tag/v${update?.version}`}
                    >
                      {update?.notes ?? 'Release notes are unavailable.'}
                    </MessageResponse>
                  </div>
                )}
                {update?.error && (
                  <p role="alert" className="mt-2 text-xs text-destructive">
                    {update.error}
                  </p>
                )}
                {update?.status === 'downloading' && (
                  <div className="mt-4" role="status" aria-live="polite">
                    <div className="flex justify-between text-xs">
                      <span>Downloading {Math.round(update?.progress ?? 0)}%</span>
                      {update?.total && (
                        <span>
                          {size(update?.transferred ?? 0)} / {size(update?.total)}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-primary"
                        style={{ width: `${Math.min(100, Math.max(0, update?.progress ?? 0))}%` }}
                      />
                    </div>
                    {!!update?.bytesPerSecond && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {size(update?.bytesPerSecond)}/s
                      </p>
                    )}
                  </div>
                )}
                {update?.status === 'restarting' && (
                  <p className="mt-4 text-xs">Preparing to restart…</p>
                )}
                {(!update ||
                  ['idle', 'error', 'available', 'downloaded'].includes(update.status)) && (
                  <Button
                    className="mt-4 w-full"
                    size="sm"
                    onClick={
                      update?.status === 'available' || update?.status === 'downloaded'
                        ? onUpdate
                        : onCheckUpdates
                    }
                  >
                    {update?.status === 'downloaded'
                      ? 'Restart and install'
                      : update?.status === 'available'
                        ? 'Download update'
                        : 'Check updates'}
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
