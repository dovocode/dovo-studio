import { orderedThreadInfoSections, moveThreadInfoSection } from '@dovo/protocol'
import { readAppPreferences, updateAppPreferences, useAppPreferences } from '@dovo/studio-core'
import { DropdownMenu, IconButton } from '@dovo/studio-ui'
import { ArrowUp, ArrowDown, Check, SlidersHorizontal } from 'lucide-react'
import { useRef, useState } from 'react'

export function ThreadInfoCustomization() {
  const { threadInfoSections: choices, threadInfoOrder } = useAppPreferences()
  const sections = orderedThreadInfoSections(threadInfoOrder)
  const trigger = useRef<HTMLButtonElement>(null)
  const [sideOffset, setSideOffset] = useState(8)
  return (
    <DropdownMenu.Root
      onOpenChange={(open) => {
        const button = trigger.current
        const header = button?.closest('header')
        if (open && button && header)
          setSideOffset(
            header.getBoundingClientRect().bottom - button.getBoundingClientRect().bottom + 8,
          )
      }}
    >
      <DropdownMenu.Trigger asChild>
        <IconButton ref={trigger} label="Customize thread info" className="size-7">
          <SlidersHorizontal size={14} />
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={sideOffset}
          className="studio-menu-surface z-50 max-h-[80dvh] min-w-60 overflow-y-auto rounded-xl border bg-popover p-1 text-xs text-popover-foreground"
        >
          <DropdownMenu.Label className="px-2 py-2 text-muted-foreground">
            Show and arrange thread info
          </DropdownMenu.Label>
          {sections.map(({ id, label }, index) => (
            <div key={id} className="flex items-center gap-1">
              <DropdownMenu.CheckboxItem
                checked={choices[id] !== false}
                onSelect={(event) => event.preventDefault()}
                onCheckedChange={(visible) =>
                  updateAppPreferences({
                    threadInfoSections: {
                      ...readAppPreferences().threadInfoSections,
                      [id]: visible,
                    },
                  })
                }
                className="relative flex flex-1 cursor-default items-center rounded-lg py-2 pr-2 pl-7 outline-none data-[highlighted]:bg-accent"
              >
                <DropdownMenu.ItemIndicator className="absolute left-2">
                  <Check size={12} />
                </DropdownMenu.ItemIndicator>
                {label}
              </DropdownMenu.CheckboxItem>
              {([-1, 1] as const).map((direction) => (
                <DropdownMenu.Item
                  key={direction}
                  aria-label={`Move ${label} ${direction === -1 ? 'up' : 'down'}`}
                  disabled={direction === -1 ? index === 0 : index === sections.length - 1}
                  onSelect={(event) => {
                    event.preventDefault()
                    updateAppPreferences({
                      threadInfoOrder: moveThreadInfoSection(
                        readAppPreferences().threadInfoOrder,
                        id,
                        direction,
                      ),
                    })
                  }}
                  className="rounded-lg p-2 outline-none data-[highlighted]:bg-accent data-[disabled]:opacity-30"
                >
                  {direction === -1 ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
                </DropdownMenu.Item>
              ))}
            </div>
          ))}
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item
            disabled={
              !Object.values(choices).some((visible) => !visible) && !threadInfoOrder?.length
            }
            onSelect={() => updateAppPreferences({ threadInfoSections: {}, threadInfoOrder: [] })}
            className="rounded-lg px-2 py-2 outline-none data-[highlighted]:bg-accent data-[disabled]:opacity-50"
          >
            Reset to default
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
