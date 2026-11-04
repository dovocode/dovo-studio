import { ArrowDown, ArrowUp, ArrowUpDown, LockKeyhole } from 'lucide-react'
import { useState } from 'react'
import { defaultThreadSectionOrder, moveThreadSection, threadSections } from '@dovo/protocol'
import { updateAppPreferences, useAppPreferences } from '@dovo/studio-core'
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@dovo/studio-ui'

export function SectionOrderDialog() {
  const [open, setOpen] = useState(false)
  const preferences = useAppPreferences()
  const order = [
    'pinned' as const,
    ...(preferences.threadSectionOrder ?? defaultThreadSectionOrder).filter(
      (id) => id !== 'pinned',
    ),
  ]
  const isDefaultOrder = order.every((id, index) => id === defaultThreadSectionOrder[index])
  return (
    <>
      <Button
        size="icon"
        variant="ghost"
        className="size-8 shrink-0"
        aria-label="Organize sections"
        title="Organize sections"
        onClick={() => setOpen(true)}
      >
        <ArrowUpDown size={15} />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogTitle>Organize sections</DialogTitle>
          <DialogDescription>
            Pinned stays first. Needs input appears automatically below it and cannot be moved.
            Reorder the other categories. Empty sections stay hidden. Project and ungrouped threads
            use Open’s position.
          </DialogDescription>
          <ol className="space-y-1" aria-label="Thread section order">
            {order.map((id, index) => (
              <li key={id} className="flex items-center gap-2 rounded-md border px-3 py-1">
                <span className="flex-1 text-sm">
                  {threadSections.find((section) => section.id === id)?.name}
                </span>
                {id === 'pinned' ? (
                  <span className="flex h-8 items-center gap-1.5 text-xs text-muted-foreground">
                    <LockKeyhole size={13} aria-hidden="true" />
                    Fixed first
                  </span>
                ) : (
                  <>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8"
                      aria-label={`Move ${id === 'active' ? 'open' : id} up`}
                      disabled={index <= 1}
                      onClick={() =>
                        updateAppPreferences({
                          threadSectionOrder: moveThreadSection(order, id, -1),
                        })
                      }
                    >
                      <ArrowUp size={14} />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="size-8"
                      aria-label={`Move ${id === 'active' ? 'open' : id} down`}
                      disabled={index === order.length - 1}
                      onClick={() =>
                        updateAppPreferences({
                          threadSectionOrder: moveThreadSection(order, id, 1),
                        })
                      }
                    >
                      <ArrowDown size={14} />
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ol>
          <Button
            variant="outline"
            disabled={isDefaultOrder}
            onClick={() =>
              updateAppPreferences({ threadSectionOrder: [...defaultThreadSectionOrder] })
            }
          >
            Reset section order
          </Button>
        </DialogContent>
      </Dialog>
    </>
  )
}
