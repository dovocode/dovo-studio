import { taskSnoozeMenuChoices } from '@dovo/protocol'
import { useAppPreferences } from '@dovo/studio-core'
import { DropdownMenu, IconButton } from '@dovo/studio-ui'
import { AlarmClock, Check, ChevronRight, MoreHorizontal, Pin, PinOff, Undo2 } from 'lucide-react'

export interface WorkspaceResourceMenuProps {
  title: string
  pinned: boolean
  settled: boolean
  snoozedUntil?: string
  disabled?: boolean
  settleDisabled?: boolean
  onPin: () => void
  onSettle: () => void
  onSnooze: (until: string | null) => void
}

const menuClass = 'z-50 min-w-44 rounded-md border bg-popover p-1 text-popover-foreground shadow-md'
const itemClass =
  'flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-xs outline-none data-[highlighted]:bg-accent/55 data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0'

export function WorkspaceResourceMenu({
  title,
  pinned,
  settled,
  snoozedUntil,
  disabled = false,
  settleDisabled = false,
  onPin,
  onSettle,
  onSnooze,
}: WorkspaceResourceMenuProps) {
  const { taskSnoozeMinutes, taskSnoozeSchedule } = useAppPreferences()
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <IconButton
          label={`Actions for ${title}`}
          title={`Actions for ${title}`}
          className="size-7 shrink-0"
          disabled={disabled}
        >
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content className={menuClass} sideOffset={4} collisionPadding={8}>
          <DropdownMenu.Item className={itemClass} onSelect={onPin}>
            {pinned ? <PinOff aria-hidden="true" /> : <Pin aria-hidden="true" />}
            {pinned ? 'Unpin' : 'Pin'}
          </DropdownMenu.Item>
          <DropdownMenu.Item className={itemClass} disabled={settleDisabled} onSelect={onSettle}>
            {settled ? <Undo2 aria-hidden="true" /> : <Check aria-hidden="true" />}
            {settled ? 'Reopen' : 'Settle'}
          </DropdownMenu.Item>
          {!settled && (
            <DropdownMenu.Sub>
              <DropdownMenu.SubTrigger className={itemClass}>
                <AlarmClock aria-hidden="true" /> Snooze{' '}
                <ChevronRight className="ml-auto" aria-hidden="true" />
              </DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent className={menuClass} collisionPadding={8}>
                  {taskSnoozeMenuChoices(taskSnoozeMinutes, taskSnoozeSchedule).map(
                    ({ id, label, until }) => (
                      <DropdownMenu.Item
                        key={id}
                        className={itemClass}
                        onSelect={() => onSnooze(until())}
                      >
                        {label}
                      </DropdownMenu.Item>
                    ),
                  )}
                  {snoozedUntil && Date.parse(snoozedUntil) > Date.now() && (
                    <DropdownMenu.Item className={itemClass} onSelect={() => onSnooze(null)}>
                      Unsnooze
                    </DropdownMenu.Item>
                  )}
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
