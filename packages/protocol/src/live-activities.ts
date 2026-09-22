import { z } from 'zod'
import type { Task } from './workspace.js'

export const liveActivityRegistrationSchema = z.object({
  activityId: z.string().min(1).max(200),
  taskId: z.string().min(1).max(200),
  turnId: z.string().min(1).max(200),
  pushToken: z.string().regex(/^[a-fA-F0-9]{32,512}$/),
})
export const liveActivityStatusSchema = z.object({
  configured: z.boolean(),
  environment: z.enum(['sandbox', 'production']),
  error: z.string().nullable(),
})
export const liveTaskPropsSchema = z.object({
  title: z.string(),
  project: z.string(),
  device: z.string(),
  status: z.enum(['Working', 'Needs input', 'Done', 'Failed', 'Stopped']),
  startedAt: z.number(),
})
export type LiveTaskProps = z.infer<typeof liveTaskPropsSchema>
export function liveTaskProps(
  task: Task,
  device: string,
  project: string,
  needsInput: boolean,
): LiveTaskProps {
  const turn = task.turns?.at(-1)
  return {
    title: task.title.slice(0, 100),
    project: project.slice(0, 60),
    device: device.slice(0, 60),
    status:
      task.status === 'running'
        ? needsInput
          ? 'Needs input'
          : 'Working'
        : task.status === 'failed'
          ? 'Failed'
          : task.status === 'cancelled' || task.status === 'draft'
            ? 'Stopped'
            : 'Done',
    startedAt: Date.parse(turn?.startedAt ?? task.createdAt) || 0,
  }
}
