import { Schema } from 'effect'
import { mutableStruct, minValue, maxValue } from '../../shared/schema.js'
import { remoteBrowserInputSchema } from './remote-browser.js'

const coordinate = maxValue(minValue(Schema.Number.pipe(Schema.check(Schema.isFinite())), 0), 1920)
const duration = maxValue(minValue(Schema.Number.pipe(Schema.check(Schema.isFinite())), 50), 5000)
const point = { x: coordinate, y: coordinate }
export const deviceGestureSchema = Schema.Union([
  mutableStruct({
    type: Schema.Literal('gesture'),
    gesture: Schema.Literals(['double-tap', 'long-press']),
    ...point,
    durationMs: duration,
  }),
  mutableStruct({
    type: Schema.Literal('gesture'),
    gesture: Schema.Literal('drag'),
    ...point,
    endX: coordinate,
    endY: coordinate,
    durationMs: duration,
  }),
  mutableStruct({
    type: Schema.Literal('gesture'),
    gesture: Schema.Literal('pinch'),
    ...point,
    startRadius: maxValue(minValue(coordinate, 1), 960),
    endRadius: maxValue(minValue(coordinate, 1), 960),
    durationMs: duration,
  }),
])
export const deviceButtonSchema = mutableStruct({
  type: Schema.Literal('device-button'),
  button: Schema.Literals([
    'home',
    'back',
    'app-switcher',
    'lock',
    'volume-up',
    'volume-down',
    'mute',
  ]),
})
export const simulatorInputSchema = Schema.Union([
  remoteBrowserInputSchema,
  deviceGestureSchema,
  deviceButtonSchema,
])
export type SimulatorInput = Schema.Schema.Type<typeof simulatorInputSchema>
