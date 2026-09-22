import { z } from 'zod'
import { previewDeviceSchema } from './previews.js'

export const remoteBrowserViewportSchema = z.object({
  width: z.number().int().min(240).max(1920),
  height: z.number().int().min(240).max(1920),
})
export const remoteBrowserOpenSchema = z.object({ taskId: z.string().min(1).max(200) })
export const remoteBrowserTicketSchema = z.object({
  ticket: z.string(),
  host: z.string(),
  device: previewDeviceSchema.optional(),
})
const point = { x: z.number().min(0).max(1920), y: z.number().min(0).max(1920) }
export const remoteBrowserInputSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('navigate'), url: z.string().min(1).max(4096) }),
  z.object({ type: z.enum(['back', 'forward', 'reload', 'status']) }),
  z.object({ type: z.literal('resize'), ...remoteBrowserViewportSchema.shape }),
  z.object({
    type: z.literal('pointer'),
    phase: z.enum(['move', 'down', 'up']),
    pointerType: z.enum(['mouse', 'touch']).optional(),
    button: z.enum(['left', 'middle', 'right']).default('left'),
    ...point,
  }),
  z.object({
    type: z.literal('scroll'),
    ...point,
    deltaX: z.number().min(-4000).max(4000),
    deltaY: z.number().min(-4000).max(4000),
  }),
  z.object({ type: z.literal('text'), text: z.string().min(1).max(16000) }),
  z.object({
    type: z.literal('key'),
    key: z
      .string()
      .min(1)
      .max(40)
      .regex(
        /^(?:(?:Control|Meta|Alt|Shift)\+)*(?:\P{C}|Enter|Tab|Escape|Backspace|Delete|ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End|PageUp|PageDown|Space)$/u,
      ),
  }),
  z.object({
    type: z.literal('dialog'),
    accept: z.boolean(),
    text: z.string().max(16000).optional(),
  }),
])
export type RemoteBrowserInput = z.infer<typeof remoteBrowserInputSchema>
export const remoteBrowserFrameAckSchema = z.object({
  type: z.literal('frameAck'),
  sequence: z.number().int().min(1).max(0xffffffff),
})
export const remoteBrowserDialogSchema = z.object({
  type: z.literal('dialog'),
  kind: z.enum(['alert', 'confirm', 'prompt', 'beforeunload']),
  message: z.string(),
  defaultValue: z.string(),
})
export const remoteBrowserMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('frame'), data: z.string(), width: z.number(), height: z.number() }),
  z.object({
    type: z.literal('state'),
    url: z.string(),
    title: z.string(),
    back: z.boolean(),
    forward: z.boolean(),
    loading: z.boolean(),
    editable: z.boolean(),
    touch: z.boolean().optional(),
  }),
  z.object({ type: z.literal('error'), message: z.string() }),
  z.object({ type: z.literal('closed'), message: z.string() }),
  remoteBrowserDialogSchema,
])
export type RemoteBrowserMessage = z.infer<typeof remoteBrowserMessageSchema>
