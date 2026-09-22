import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { Bot, CircleCheck, Zap } from 'lucide-react'
import { useWorkspace, type AutomationData } from '@dovo/studio-core'
import { cn } from '@dovo/studio-ui'
import { pendingTaskInput, type RunStep } from './run-progress'
import { StepStatus } from './run-details'
export type FlowNode = Node<AutomationData & { runStep?: RunStep }, 'automation'>
export function AutomationNodeView({ data, selected }: NodeProps<FlowNode>) {
  const { snapshot } = useWorkspace()
  const Icon = data.kind === 'trigger' ? Zap : data.kind === 'task' ? Bot : CircleCheck
  return (
    <div
      className={cn(
        'w-60 rounded-lg border bg-card p-4 shadow-lg',
        selected && 'border-primary ring-1 ring-primary',
      )}
    >
      {data.kind !== 'trigger' && <Handle type="target" position={Position.Left} />}
      <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <Icon size={14} />
        {data.kind}
      </div>
      <div className="text-sm font-medium">{data.label}</div>
      <p className="mt-2 truncate text-xs text-muted-foreground">
        {data.kind === 'trigger'
          ? data.trigger === 'schedule'
            ? data.schedule
            : data.trigger
          : data.kind === 'task'
            ? data.objective || 'Configure task instructions'
            : 'Pause for your review'}
      </p>
      {data.runStep && (
        <div className="mt-3 border-t pt-2">
          <StepStatus
            step={data.runStep}
            needsInput={
              data.runStep.status === 'running' && !!pendingTaskInput(snapshot, data.runStep.taskId)
            }
          />
        </div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
