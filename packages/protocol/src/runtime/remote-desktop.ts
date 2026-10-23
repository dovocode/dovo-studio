import { Schema } from 'effect'
import { mutableStruct, minValue, maxValue } from '../shared/schema.js'
import { uuidSchema } from '../shared/schema.js'

const coordinate = Schema.Number.pipe(
  Schema.check(Schema.isFinite()),
  Schema.check(Schema.isGreaterThanOrEqualTo(0)),
)
export const remoteDesktopInputSchema = Schema.Union([
  mutableStruct({
    type: Schema.Literal('click'),
    x: coordinate,
    y: coordinate,
    button: Schema.Literals(['left', 'right']),
    count: Schema.Literals([1, 2]),
  }),
  mutableStruct({ type: Schema.Literal('move'), x: coordinate, y: coordinate }),
  mutableStruct({
    type: Schema.Literal('drag'),
    x: coordinate,
    y: coordinate,
    toX: coordinate,
    toY: coordinate,
  }),
  mutableStruct({
    type: Schema.Literal('key'),
    key: minValue(maxValue(Schema.String, 80), 1),
    modifiers: Schema.optional(Schema.Array(Schema.Literals(['cmd', 'ctrl', 'alt', 'shift']))),
  }),
  mutableStruct({ type: Schema.Literal('text'), text: minValue(maxValue(Schema.String, 4000), 1) }),
  mutableStruct({
    type: Schema.Literal('scroll'),
    direction: Schema.Literals(['up', 'down', 'left', 'right']),
    x: Schema.optional(coordinate),
    y: Schema.optional(coordinate),
    amount: Schema.Number.pipe(
      Schema.check(Schema.isInt()),
      Schema.check(Schema.isBetween({ minimum: 1, maximum: 10 })),
    ),
  }),
])
export const remoteDesktopRequestSchema = Schema.Union([
  mutableStruct({ action: Schema.Literal('start'), id: uuidSchema }),
  mutableStruct({ action: Schema.Literal('frame'), id: uuidSchema }),
  mutableStruct({ action: Schema.Literal('stop'), id: uuidSchema }),
  mutableStruct({ action: Schema.Literal('control'), id: uuidSchema, enabled: Schema.Boolean }),
  mutableStruct({
    action: Schema.Literal('input'),
    id: uuidSchema,
    requestId: uuidSchema,
    frameId: uuidSchema,
    input: remoteDesktopInputSchema,
  }),
])
export const remoteDesktopSessionSchema = mutableStruct({
  id: uuidSchema,
  viewer: Schema.String,
  control: Schema.Boolean,
  locked: Schema.optional(Schema.Boolean),
  unlocking: Schema.optional(Schema.Boolean),
})
export const remoteDesktopUnlockSchema = mutableStruct({ id: uuidSchema })
export const remoteDesktopFrameSchema = mutableStruct({
  id: uuidSchema,
  image: Schema.String,
  width: Schema.Number,
  height: Schema.Number,
})
export const remoteDesktopResponseSchema = mutableStruct({
  session: Schema.NullOr(remoteDesktopSessionSchema),
  frame: Schema.optional(remoteDesktopFrameSchema),
})
export type RemoteDesktopRequest = typeof remoteDesktopRequestSchema.Type
export type RemoteDesktopInput = typeof remoteDesktopInputSchema.Type
export type RemoteDesktopFrame = typeof remoteDesktopFrameSchema.Type
