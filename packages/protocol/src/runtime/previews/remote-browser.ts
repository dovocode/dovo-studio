import { browserProfileIdSchema } from './browser-profiles.js'
import { mutableStruct } from '../../shared/schema.js'
import { minValue, maxValue } from '../../shared/schema.js'
import { Schema, Effect } from 'effect'
import { previewDeviceSchema } from './previews.js'
export const remoteBrowserViewportSchema = mutableStruct({
  width: maxValue(
    minValue(
      Schema.Number.pipe(Schema.check(Schema.isFinite())).pipe(
        Schema.check(Schema.isInt()),
        Schema.check(
          Schema.isBetween({ minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }),
        ),
      ),
      240,
    ),
    1920,
  ),
  height: maxValue(
    minValue(
      Schema.Number.pipe(Schema.check(Schema.isFinite())).pipe(
        Schema.check(Schema.isInt()),
        Schema.check(
          Schema.isBetween({ minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }),
        ),
      ),
      240,
    ),
    1920,
  ),
})
export const remoteBrowserOpenSchema = mutableStruct({
  taskId: maxValue(minValue(Schema.String, 1), 200),
  tabId: Schema.optional(maxValue(minValue(Schema.String, 1), 200)),
  profileId: Schema.optional(browserProfileIdSchema),
  url: Schema.optional(maxValue(Schema.String, 4096)),
})
export const remoteBrowserTicketSchema = mutableStruct({
  ticket: Schema.String,
  host: Schema.String,
  tabId: Schema.optional(Schema.String),
  profileId: Schema.optional(browserProfileIdSchema),
  device: Schema.optional(previewDeviceSchema),
})
const point = {
  x: maxValue(minValue(Schema.Number.pipe(Schema.check(Schema.isFinite())), 0), 1920),
  y: maxValue(minValue(Schema.Number.pipe(Schema.check(Schema.isFinite())), 0), 1920),
}
export const remoteBrowserInputSchema = Schema.Union([
  mutableStruct({
    type: Schema.Literal('navigate'),
    url: maxValue(minValue(Schema.String, 1), 4096),
  }),
  mutableStruct({
    type: Schema.Literals(['back', 'forward', 'reload', 'status']),
  }),
  mutableStruct({
    type: Schema.Literal('visibility'),
    visible: Schema.Boolean,
  }),
  mutableStruct({
    type: Schema.Literal('resize'),
    ...remoteBrowserViewportSchema.fields,
  }),
  mutableStruct({
    type: Schema.Literal('pointer'),
    phase: Schema.Literals(['move', 'down', 'up']),
    pointerType: Schema.optional(Schema.Literals(['mouse', 'touch'])),
    button: Schema.Literals(['left', 'middle', 'right']).pipe(
      Schema.withDecodingDefaultType(Effect.sync(() => 'left')),
    ),
    ...point,
  }),
  mutableStruct({
    type: Schema.Literal('scroll'),
    ...point,
    deltaX: maxValue(minValue(Schema.Number.pipe(Schema.check(Schema.isFinite())), -4000), 4000),
    deltaY: maxValue(minValue(Schema.Number.pipe(Schema.check(Schema.isFinite())), -4000), 4000),
  }),
  mutableStruct({
    type: Schema.Literal('text'),
    text: maxValue(minValue(Schema.String, 1), 16000),
  }),
  mutableStruct({
    type: Schema.Literal('key'),
    key: maxValue(minValue(Schema.String, 1), 40).pipe(
      Schema.check(
        Schema.isPattern(
          /^(?:(?:Control|Meta|Alt|Shift)\+)*(?:\P{C}|Enter|Tab|Escape|Backspace|Delete|ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End|PageUp|PageDown|Space)$/u,
        ),
      ),
    ),
  }),
  mutableStruct({
    type: Schema.Literal('dialog'),
    accept: Schema.Boolean,
    text: Schema.optional(maxValue(Schema.String, 16000)),
  }),
])
export type RemoteBrowserInput = Schema.Schema.Type<typeof remoteBrowserInputSchema>
export const remoteBrowserFrameAckSchema = mutableStruct({
  type: Schema.Literal('frameAck'),
  sequence: maxValue(
    minValue(
      Schema.Number.pipe(Schema.check(Schema.isFinite())).pipe(
        Schema.check(Schema.isInt()),
        Schema.check(
          Schema.isBetween({ minimum: Number.MIN_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER }),
        ),
      ),
      1,
    ),
    0xffffffff,
  ),
})
export const remoteBrowserDialogSchema = mutableStruct({
  type: Schema.Literal('dialog'),
  kind: Schema.Literals(['alert', 'confirm', 'prompt', 'beforeunload']),
  message: Schema.String,
  defaultValue: Schema.String,
})
export const remoteBrowserMessageSchema = Schema.Union([
  mutableStruct({
    type: Schema.Literal('frame'),
    data: Schema.String,
    width: Schema.Number.pipe(Schema.check(Schema.isFinite())),
    height: Schema.Number.pipe(Schema.check(Schema.isFinite())),
  }),
  mutableStruct({
    type: Schema.Literal('state'),
    url: Schema.String,
    title: Schema.String,
    back: Schema.Boolean,
    forward: Schema.Boolean,
    loading: Schema.Boolean,
    editable: Schema.Boolean,
    touch: Schema.optional(Schema.Boolean),
  }),
  mutableStruct({
    type: Schema.Literal('error'),
    message: Schema.String,
  }),
  mutableStruct({
    type: Schema.Literal('closed'),
    message: Schema.String,
  }),
  remoteBrowserDialogSchema,
])
export type RemoteBrowserMessage = Schema.Schema.Type<typeof remoteBrowserMessageSchema>
