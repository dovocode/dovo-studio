import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { orderedThreadInfoSections, moveThreadInfoSection } from '@dovo/protocol'
import { readAppPreferences, updateAppPreferences, useAppPreferences } from '@dovo/studio-core'
import { DropdownMenu, IconButton } from '@dovo/studio-ui'
import { ArrowUp, ArrowDown, Check, SlidersHorizontal } from 'lucide-react'
import { useRef, useState } from 'react'

export function ThreadInfoCustomization() {
  const uiText = useInterfaceText()

  const { threadInfoSections: choices, threadInfoOrder } = useAppPreferences()
  const sections = orderedThreadInfoSections(threadInfoOrder)
  const trigger = useRef<HTMLButtonElement>(null)
  const donePointerDown = useRef(false)
  const [bounds, setBounds] = useState({
    sideOffset: 8,
    alignOffset: 0,
    width: 320,
    minHeight: 0,
    maxHeight: '80dvh',
  })
  return (
    <DropdownMenu.Root
      onOpenChange={(open) => {
        const button = trigger.current
        const panel = button?.closest<HTMLElement>('.studio-thread-info-panel')
        if (open && button && panel) {
          const panelBounds = panel.getBoundingClientRect()
          const buttonBounds = button.getBoundingClientRect()
          // Replace the whole panel visually while retaining the menu's portal and focus behavior.
          setBounds({
            sideOffset: panelBounds.top - buttonBounds.bottom,
            alignOffset: buttonBounds.right - panelBounds.right,
            width: panelBounds.width,
            minHeight: panelBounds.height,
            maxHeight: `${panelBounds.height}px`,
          })
        }
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
          side="bottom"
          sideOffset={bounds.sideOffset}
          alignOffset={bounds.alignOffset}
          avoidCollisions={false}
          aria-label="Customize thread info"
          style={{
            width: bounds.width,
            minHeight: bounds.minHeight,
            maxHeight: bounds.maxHeight,
          }}
          className="studio-menu-surface z-50 flex flex-col overflow-hidden rounded-2xl border bg-[var(--studio-floating-fill)] text-xs text-popover-foreground"
        >
          <div className="z-10 flex h-10 shrink-0 items-center justify-between gap-2 border-b bg-popover px-4">
            <DropdownMenu.Label className="text-sm font-semibold">
              Customize thread info
            </DropdownMenu.Label>
            <DropdownMenu.Item
              aria-label="Done customizing thread info"
              onPointerDown={() => {
                donePointerDown.current = true
              }}
              onPointerLeave={() => {
                donePointerDown.current = false
              }}
              onPointerCancel={() => {
                donePointerDown.current = false
              }}
              onPointerUp={(event) => {
                // Opening replaces Customize with Done under the same pointer. Radix
                // synthesizes a click on pointer-up, even when Done had no pointer-down.
                if (!donePointerDown.current) event.preventDefault()
                donePointerDown.current = false
              }}
              className="flex h-7 items-center justify-center rounded-lg px-2 outline-none data-[highlighted]:bg-accent"
            >
              {uiText('Done')}
            </DropdownMenu.Item>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
            <p className="px-2 py-2 text-muted-foreground">
              Show sections and choose their order. Empty sections appear when content is available.
            </p>
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
                  className="group relative flex flex-1 cursor-default items-center rounded-lg py-2 pr-2 pl-7 outline-none data-[highlighted]:bg-accent"
                >
                  <span
                    aria-hidden="true"
                    className="absolute left-2 grid size-3.5 place-items-center rounded-[3px] border border-muted-foreground/60 group-data-[state=checked]:border-action group-data-[state=checked]:bg-action group-data-[state=checked]:text-action-foreground"
                  >
                    <DropdownMenu.ItemIndicator>
                      <Check size={10} />
                    </DropdownMenu.ItemIndicator>
                  </span>
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
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
