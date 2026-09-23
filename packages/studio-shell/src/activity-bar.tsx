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
} from 'lucide-react'
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
  views,
  activeId,
  onSelect,
  onHelp,
}: {
  views: readonly StudioView[]
  activeId: string
  onSelect: (id: string) => void
  onHelp: () => void
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
        {!!settings.length &&
          item('settings', 'Settings', Settings, settingsActive, () => onSelect(settings[0].id))}
        {item('help', 'Walkthrough', CircleHelp, false, onHelp)}
      </div>
    </nav>
  )
}
