import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { useState } from 'react'
import { defaultThreadSectionOrder, moveThreadSection, threadSections } from '@dovo/protocol'
import { updateAppPreferences, useAppPreferences } from '@dovo/studio-core'
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle } from '@dovo/studio-ui'

export function SectionOrderDialog() {
  const [open, setOpen] = useState(false)
  const preferences = useAppPreferences()
  const order = preferences.threadSectionOrder ?? defaultThreadSectionOrder
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
            Change the order of thread categories. Empty sections stay hidden. With project or no
            grouping, those threads use Active’s position.
          </DialogDescription>
          <ol className="space-y-1" aria-label="Thread section order">
            {order.map((id, index) => (
              <li key={id} className="flex items-center gap-2 rounded-md border px-3 py-1">
                <span className="flex-1 text-sm">
                  {threadSections.find((section) => section.id === id)?.name}
                </span>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  aria-label={`Move ${id} up`}
                  disabled={index === 0}
                  onClick={() =>
                    updateAppPreferences({ threadSectionOrder: moveThreadSection(order, id, -1) })
                  }
                >
                  <ArrowUp size={14} />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-8"
                  aria-label={`Move ${id} down`}
                  disabled={index === order.length - 1}
                  onClick={() =>
                    updateAppPreferences({ threadSectionOrder: moveThreadSection(order, id, 1) })
                  }
                >
                  <ArrowDown size={14} />
                </Button>
              </li>
            ))}
          </ol>
          <Button
            variant="outline"
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
