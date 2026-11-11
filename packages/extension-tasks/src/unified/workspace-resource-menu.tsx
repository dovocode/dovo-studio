import { taskSnoozeMenuChoices } from '@dovo/protocol'
import { useAppPreferences } from '@dovo/studio-core'
import { Button, ContextMenu, DropdownMenu, IconButton } from '@dovo/studio-ui'
import { AlarmClock, Check, Pin, PinOff, Undo2 } from 'lucide-react'
import { useState } from 'react'
import { SnoozeDialog } from '../dialogs/snooze-dialog'

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

export function useWorkspaceResourceActions({
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
  const [choosingSnooze, setChoosingSnooze] = useState(false)
  const dialog = choosingSnooze ? (
    <SnoozeDialog
      name={title}
      until={snoozedUntil ? Date.parse(snoozedUntil) : undefined}
      onClose={() => setChoosingSnooze(false)}
      onSnooze={(until) => {
        if (disabled) throw new Error('This item cannot be snoozed now.')
        onSnooze(new Date(until).toISOString())
      }}
    />
  ) : null
  const options = taskSnoozeMenuChoices(taskSnoozeMinutes, taskSnoozeSchedule)
  const snoozed = !!snoozedUntil && Date.parse(snoozedUntil) > Date.now()
  const inline = (
    <div
      role="group"
      aria-label={`Actions for ${title}`}
      className="studio-thread-actions flex h-6 items-center gap-1"
    >
      <IconButton
        type="button"
        label={`${pinned ? 'Unpin' : 'Pin'} ${title}`}
        title={`${pinned ? 'Unpin' : 'Pin'} ${title}`}
        className="size-6 shrink-0"
        disabled={disabled}
        onClick={onPin}
      >
        {pinned ? (
          <PinOff className="size-3.5" aria-hidden="true" />
        ) : (
          <Pin className="size-3.5" aria-hidden="true" />
        )}
      </IconButton>
      {!settled && (
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <IconButton
              type="button"
              label={`Snooze ${title}`}
              title={`Snooze ${title}`}
              className="size-6 shrink-0"
              disabled={disabled}
            >
              <AlarmClock className="size-3.5" aria-hidden="true" />
            </IconButton>
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content className={menuClass} sideOffset={4} collisionPadding={8}>
              {options.map(({ id, label, until }) => (
                <DropdownMenu.Item
                  key={id}
                  disabled={disabled}
                  className={itemClass}
                  onSelect={() => onSnooze(until())}
                >
                  {label}
                </DropdownMenu.Item>
              ))}
              {snoozed && (
                <DropdownMenu.Item
                  disabled={disabled}
                  className={itemClass}
                  onSelect={() => onSnooze(null)}
                >
                  Unsnooze
                </DropdownMenu.Item>
              )}
              <DropdownMenu.Item
                disabled={disabled}
                className={itemClass}
                onSelect={() => setChoosingSnooze(true)}
              >
                Choose date and time…
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      )}
      <Button
        type="button"
        variant="ghost"
        className="h-6 gap-1 px-1 text-[0.6875rem]"
        aria-label={`${settled ? 'Reopen' : 'Settle'} ${title}`}
        disabled={disabled || settleDisabled}
        onClick={onSettle}
      >
        {settled ? (
          <Undo2 className="size-3.5" aria-hidden="true" />
        ) : (
          <Check className="size-3.5" aria-hidden="true" />
        )}
        {settled ? 'Reopen' : 'Settle'}
      </Button>
    </div>
  )
  const context = (
    <>
      <ContextMenu.Item className={itemClass} disabled={disabled} onSelect={onPin}>
        {pinned ? <PinOff /> : <Pin />}
        {pinned ? 'Unpin' : 'Pin'}
      </ContextMenu.Item>
      {!settled && (
        <ContextMenu.Sub>
          <ContextMenu.SubTrigger className={itemClass} disabled={disabled}>
            <AlarmClock /> Snooze
          </ContextMenu.SubTrigger>
          <ContextMenu.Portal>
            <ContextMenu.SubContent className={menuClass} collisionPadding={8}>
              {options.map(({ id, label, until }) => (
                <ContextMenu.Item
                  key={id}
                  disabled={disabled}
                  className={itemClass}
                  onSelect={() => onSnooze(until())}
                >
                  {label}
                </ContextMenu.Item>
              ))}
              {snoozed && (
                <ContextMenu.Item
                  className={itemClass}
                  disabled={disabled}
                  onSelect={() => onSnooze(null)}
                >
                  Unsnooze
                </ContextMenu.Item>
              )}
              <ContextMenu.Item
                className={itemClass}
                disabled={disabled}
                onSelect={() => setChoosingSnooze(true)}
              >
                Choose date and time…
              </ContextMenu.Item>
            </ContextMenu.SubContent>
          </ContextMenu.Portal>
        </ContextMenu.Sub>
      )}
      <ContextMenu.Item
        className={itemClass}
        disabled={disabled || settleDisabled}
        onSelect={onSettle}
      >
        {settled ? <Undo2 /> : <Check />}
        {settled ? 'Reopen' : 'Settle'}
      </ContextMenu.Item>
    </>
  )
  return { inline, context, dialog }
}

export function WorkspaceResourceMenu(props: WorkspaceResourceMenuProps) {
  const { inline, dialog } = useWorkspaceResourceActions(props)
  return (
    <>
      {inline}
      {dialog}
    </>
  )
}
