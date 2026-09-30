import { useState, type ReactNode } from 'react'
import type { TaskTurn } from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { TurnLabel } from './turn-label'

/** Keep the answer outside the work disclosure, including older unsplit replies. */
export function TurnWork({
  turn,
  finalIndex,
  children,
}: {
  turn: TaskTurn
  finalIndex: number
  children: ReactNode[]
}) {
  const [open, setOpen] = useState(true)
  const label =
    turn.status === 'running' ? (
      'Turn in progress'
    ) : turn.status === 'completed' ? (
      <TurnLabel turn={turn} />
    ) : turn.status === 'failed' ? (
      'Turn failed'
    ) : (
      'Turn stopped'
    )
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-fit px-1 text-xs text-muted-foreground"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
        {label}
      </Button>
      {open ? children : finalIndex >= 0 && children[finalIndex]}
    </>
  )
}
