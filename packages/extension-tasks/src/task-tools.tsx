import { Bot, Files, Globe, Smartphone, Terminal } from 'lucide-react'
import { Button, Tooltip, TooltipContent, TooltipTrigger, cn } from '@dovo/studio-ui'
import type { TaskSurface } from './task-header'

export function TaskTools({
  surface,
  onSelect,
}: {
  surface: TaskSurface
  onSelect: (surface: TaskSurface) => void
}) {
  return (
    <nav className="studio-navigation studio-tools-navigation" aria-label="Thread tools">
      <span className="studio-navigation-heading" aria-hidden="true">
        Thread
      </span>
      {(
        [
          ['changes', 'Diff & files', Files],
          ['browser', 'Browser', Globe],
          ['devices', 'Simulators', Smartphone],
          ['terminal', 'Terminal', Terminal],
          ['agents', 'Agents', Bot],
        ] as const
      ).map(([id, label, Icon]) => (
        <Tooltip key={id}>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={label}
              aria-pressed={surface === id}
              className={cn('studio-navigation-item', surface === id && 'is-active')}
              onClick={() => onSelect(id)}
            >
              <Icon size={18} strokeWidth={1.7} aria-hidden="true" />
              <span className="studio-navigation-label">{label}</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="left" sideOffset={10}>
            {label}
          </TooltipContent>
        </Tooltip>
      ))}
    </nav>
  )
}
