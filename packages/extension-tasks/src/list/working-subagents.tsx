import { memo } from 'react'
import { subagentMetadata, type SubagentListItem } from '@dovo/protocol'
import { cn } from '@dovo/studio-ui'
export const WorkingSubagents = memo(function WorkingSubagents({
  subagents,
  online,
  disabled,
  selectedChildId,
  onOpenSubagent,
}: {
  subagents: readonly SubagentListItem[]
  online: boolean
  disabled: boolean
  selectedChildId?: string
  onOpenSubagent: (id: string) => void
}) {
  if (!subagents.length) return null
  return (
    <div className="mb-2 flex flex-wrap gap-1 px-2.5" aria-label="Working subagents">
      {subagents.map((agent, index) => {
        const childId = agent.source === 'dovo' ? (agent.taskId ?? agent.id) : undefined
        const label = `${agent.name} · ${agent.provider}`
        const detail = [
          label,
          online ? 'Working' : 'Last seen working',
          subagentMetadata(agent),
          agent.activity,
        ]
          .filter(Boolean)
          .join(' · ')
        const className = cn(
          'inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[0.625rem] text-muted-foreground',
          childId === selectedChildId && 'border-primary/50 bg-accent text-foreground',
        )
        return childId ? (
          <button
            key={`${agent.provider}:${agent.id}:${index}`}
            type="button"
            className={cn(className, 'hover:bg-accent/60')}
            aria-label={`Open subagent ${detail}`}
            aria-current={childId === selectedChildId ? 'true' : undefined}
            title={detail}
            disabled={disabled}
            onClick={() => onOpenSubagent(childId)}
          >
            <span className="size-1.5 shrink-0 rounded-full bg-sky-400" aria-hidden="true" />
            <span className="truncate">{label}</span>
          </button>
        ) : (
          <span
            key={`${agent.provider}:${agent.id}:${index}`}
            className={className}
            title={detail}
            aria-label={detail}
          >
            <span className="size-1.5 shrink-0 rounded-full bg-sky-400" aria-hidden="true" />
            <span className="truncate">{label}</span>
          </span>
        )
      })}
    </div>
  )
})
