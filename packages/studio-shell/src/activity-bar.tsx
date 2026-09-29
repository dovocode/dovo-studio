import {
  Settings,
  Bot,
  CircleDot,
  CircleHelp,
  GitBranch,
  GitPullRequest,
  LayoutDashboard,
  ListChecks,
  MonitorSmartphone,
  MessagesSquare,
  Workflow,
  Download,
} from 'lucide-react'
import type { DesktopUpdateState } from '@dovo/protocol'
import type { StudioIcon, StudioView } from '@dovo/studio-core'
import { Button, Tooltip, TooltipContent, TooltipTrigger, cn } from '@dovo/studio-ui'

const icons: Record<StudioIcon, typeof Bot> = {
  tasks: MessagesSquare,
  issues: CircleDot,
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
  onHelp,
  update,
  onUpdate,
}: {
  taskHeader?: boolean
  views: readonly StudioView[]
  activeId: string
  onSelect: (id: string) => void
  onHelp: () => void
  update?: DesktopUpdateState
  onUpdate?: () => void
}) {
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
        {!!onUpdate && !!update && update.status !== 'idle' && update.status !== 'error' && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Update ${update.version ?? ''} ${update.status === 'downloading' ? 'downloading' : 'available'}`}
                className="studio-navigation-item studio-update-item"
                disabled={update.status === 'downloading'}
                onClick={onUpdate}
              >
                <Download size={18} strokeWidth={1.7} aria-hidden="true" />
                <span className="studio-update-dot" />
              </Button>
            </TooltipTrigger>
            <TooltipContent
              side="right"
              sideOffset={10}
              className="max-h-80 max-w-96 overflow-y-auto whitespace-pre-wrap"
            >
              <strong>
                Update {update.version ?? ''}{' '}
                {update.status === 'downloaded' ? 'ready to install' : 'available'}
              </strong>
              <p className="mt-2">{update.notes ?? 'Release notes are unavailable.'}</p>
              <p className="mt-2 opacity-70">
                {update.status === 'downloading'
                  ? `Downloading ${Math.round(update.progress ?? 0)}%`
                  : update.status === 'downloaded'
                    ? 'Click to install'
                    : 'Click to download and install'}
              </p>
            </TooltipContent>
          </Tooltip>
        )}
        {!!settings.length &&
          item('settings', 'Settings', Settings, settingsActive, () => onSelect(settings[0].id))}
        {item('help', 'Walkthrough', CircleHelp, false, onHelp)}
      </div>
    </nav>
  )
}
