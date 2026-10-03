import { useState, type ReactNode } from 'react'
import type { TaskTurn } from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { TurnLabel } from './turn-label'

/** Keep the answer outside the work disclosure, including older unsplit replies. */
export function TurnWork({
  turn,
  children,
  reveal = false,
}: {
  turn: TaskTurn
  reveal?: boolean
  children: (open: boolean, header: ReactNode) => ReactNode
}) {
  const [expanded, setExpanded] = useState<boolean | null>(null)
  const open = reveal || (expanded ?? turn.status !== 'completed')
  const label =
    turn.status === 'running' || turn.status === 'completed' ? (
      <TurnLabel turn={turn} />
    ) : turn.status === 'failed' ? (
      'Turn failed'
    ) : (
      'Turn stopped'
    )
  const header = (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 w-fit px-1 text-xs text-muted-foreground"
      aria-expanded={open}
      onClick={() => setExpanded(!open)}
    >
      {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
      {label}
    </Button>
  )
  return children(open, header)
}
