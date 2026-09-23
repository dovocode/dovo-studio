import { mutableStruct } from './schema.js'
import { minValue, maxValue } from './schema.js'
import { Schema } from 'effect'
import { previewDeviceSchema } from './previews.js'
export const remoteBrowserViewportSchema = mutableStruct({
  width: maxValue(
    minValue(
      Schema.Number.pipe(Schema.finite()).pipe(
        Schema.int(),
        Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
      ),
      240,
    ),
    1920,
  ),
  height: maxValue(
    minValue(
      Schema.Number.pipe(Schema.finite()).pipe(
        Schema.int(),
        Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
      ),
      240,
    ),
    1920,
  ),
})
export const remoteBrowserOpenSchema = mutableStruct({
  taskId: maxValue(minValue(Schema.String, 1), 200),
})
export const remoteBrowserTicketSchema = mutableStruct({
  ticket: Schema.String,
  host: Schema.String,
  device: Schema.optional(previewDeviceSchema),
})
const point = {
  x: maxValue(minValue(Schema.Number.pipe(Schema.finite()), 0), 1920),
  y: maxValue(minValue(Schema.Number.pipe(Schema.finite()), 0), 1920),
}
export const remoteBrowserInputSchema = Schema.Union(
  ...[
    mutableStruct({
      type: Schema.Literal('navigate'),
      url: maxValue(minValue(Schema.String, 1), 4096),
    }),
    mutableStruct({
      type: Schema.Literal('back', 'forward', 'reload', 'status'),
    }),
    mutableStruct({
      type: Schema.Literal('resize'),
      ...remoteBrowserViewportSchema.fields,
    }),
    mutableStruct({
      type: Schema.Literal('pointer'),
      phase: Schema.Literal('move', 'down', 'up'),
      pointerType: Schema.optional(Schema.Literal('mouse', 'touch')),
      button: Schema.optionalWith(Schema.Literal('left', 'middle', 'right'), {
        default: () => 'left',
      }),
      ...point,
    }),
    mutableStruct({
      type: Schema.Literal('scroll'),
      ...point,
      deltaX: maxValue(minValue(Schema.Number.pipe(Schema.finite()), -4000), 4000),
      deltaY: maxValue(minValue(Schema.Number.pipe(Schema.finite()), -4000), 4000),
    }),
    mutableStruct({
      type: Schema.Literal('text'),
      text: maxValue(minValue(Schema.String, 1), 16000),
    }),
    mutableStruct({
      type: Schema.Literal('key'),
      key: maxValue(minValue(Schema.String, 1), 40).pipe(
        Schema.pattern(
          /^(?:(?:Control|Meta|Alt|Shift)\+)*(?:\P{C}|Enter|Tab|Escape|Backspace|Delete|ArrowLeft|ArrowRight|ArrowUp|ArrowDown|Home|End|PageUp|PageDown|Space)$/u,
        ),
      ),
    }),
    mutableStruct({
      type: Schema.Literal('dialog'),
      accept: Schema.Boolean,
      text: Schema.optional(maxValue(Schema.String, 16000)),
    }),
  ],
)
export type RemoteBrowserInput = Schema.Schema.Type<typeof remoteBrowserInputSchema>
export const remoteBrowserFrameAckSchema = mutableStruct({
  type: Schema.Literal('frameAck'),
  sequence: maxValue(
    minValue(
      Schema.Number.pipe(Schema.finite()).pipe(
        Schema.int(),
        Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER),
      ),
      1,
    ),
    0xffffffff,
  ),
})
export const remoteBrowserDialogSchema = mutableStruct({
  type: Schema.Literal('dialog'),
  kind: Schema.Literal('alert', 'confirm', 'prompt', 'beforeunload'),
  message: Schema.String,
  defaultValue: Schema.String,
})
export const remoteBrowserMessageSchema = Schema.Union(
  ...[
    mutableStruct({
      type: Schema.Literal('frame'),
      data: Schema.String,
      width: Schema.Number.pipe(Schema.finite()),
      height: Schema.Number.pipe(Schema.finite()),
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
  ],
)
export type RemoteBrowserMessage = Schema.Schema.Type<typeof remoteBrowserMessageSchema>
