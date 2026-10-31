import { threadInfoSections } from '@dovo/protocol'
import { readAppPreferences, updateAppPreferences, useAppPreferences } from '@dovo/studio-core'
import { DropdownMenu, IconButton } from '@dovo/studio-ui'
import { Check, SlidersHorizontal } from 'lucide-react'

export function ThreadInfoCustomization() {
  const { threadInfoSections: choices } = useAppPreferences()
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <IconButton label="Customize thread info" className="size-7">
          <SlidersHorizontal size={14} />
        </IconButton>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="studio-menu-surface z-50 max-h-[80dvh] min-w-60 overflow-y-auto rounded-xl border bg-popover p-1 text-xs text-popover-foreground"
        >
          <DropdownMenu.Label className="px-2 py-2 text-muted-foreground">
            Show in thread info
          </DropdownMenu.Label>
          {threadInfoSections.map(({ id, label }) => (
            <DropdownMenu.CheckboxItem
              key={id}
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
              className="relative flex cursor-default items-center rounded-lg py-2 pr-2 pl-7 outline-none data-[highlighted]:bg-accent"
            >
              <DropdownMenu.ItemIndicator className="absolute left-2">
                <Check size={12} />
              </DropdownMenu.ItemIndicator>
              {label}
            </DropdownMenu.CheckboxItem>
          ))}
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item
            disabled={!Object.values(choices).some((visible) => !visible)}
            onSelect={() => updateAppPreferences({ threadInfoSections: {} })}
            className="rounded-lg px-2 py-2 outline-none data-[highlighted]:bg-accent data-[disabled]:opacity-50"
          >
            Reset to default
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
