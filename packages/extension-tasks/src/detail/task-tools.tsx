import { Fragment } from 'react'
import {
  Bot,
  MessageCircleQuestion,
  Files,
  FileCode2,
  Shapes,
  Globe,
  Smartphone,
  FolderSymlink,
} from 'lucide-react'
import { Button, Tooltip, TooltipContent, TooltipTrigger, cn } from '@dovo/studio-ui'
import type { TaskSurface } from './task-header'

export function TaskTools({
  surface,
  onSelect,
  hasDiff,
  artifactsEnabled = false,
}: {
  surface: TaskSurface
  onSelect: (surface: TaskSurface) => void
  hasDiff: boolean
  artifactsEnabled?: boolean
}) {
  return (
    <nav className="studio-navigation studio-tools-navigation" aria-label="Thread tools">
      <span className="studio-navigation-heading" aria-hidden="true">
        Thread
      </span>
      {(
        [
          ['files', 'Files', Files],
          ['projects', 'Linked projects', FolderSymlink],
          ...(artifactsEnabled ? [['artifacts', 'Artifacts', Shapes] as const] : []),
          ...(hasDiff ? [['changes', 'Diff', FileCode2] as const] : []),
          ['agents', 'Agents', Bot],
          ['side-chats', 'Side chats', MessageCircleQuestion],
          ['browser', 'Browsers', Globe],
          ['devices', 'Devices', Smartphone],
        ] as const
      ).map(([id, label, Icon]) => (
        <Fragment key={id}>
          {(id === 'browser' || id === 'devices') && (
            <div role="separator" className="my-1 w-5 border-t border-border" />
          )}
          <Tooltip>
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
        </Fragment>
      ))}
    </nav>
  )
}
