import { expect, it } from 'vite-plus/test'
import { Schema, Effect } from 'effect'
import {
  decode,
  decodeResult,
  isoDateTime,
  mutableStruct,
  strictStruct,
  ValidationError,
} from './schema.js'
import { runtimeRegistrySchema } from '../runtime/connection/runtime-fleet.js'

it('keeps field defaults, optional values, and strict boundary validation', () => {
  const schema = strictStruct({
    name: Schema.String.pipe(Schema.withDecodingDefaultType(Effect.sync(() => 'default'))),
    count: Schema.optional(Schema.Number.pipe(Schema.check(Schema.isFinite()))),
  })
  expect(decode(schema, {})).toEqual({ name: 'default' })
  for (const input of [{ extra: true }, { count: Infinity }, { count: NaN }]) {
    expect(decodeResult(schema, input).success).toBe(false)
    expect(() => decode(schema, input)).toThrow(ValidationError)
  }
})

it('defaults missing and undefined fields independently without accepting null', () => {
  const schema = strictStruct({
    items: Schema.mutable(Schema.Array(Schema.String)).pipe(
      Schema.withDecodingDefaultType(Effect.sync(() => [])),
    ),
  })
  const first = decode(schema, {})
  const second = decode(schema, { items: undefined })
  first.items.push('first')
  expect(second.items).toEqual([])
  expect(decodeResult(schema, { items: null }).success).toBe(false)
  expect(Schema.encodeSync(schema)(first)).toEqual({ items: ['first'] })
})

it('keeps nested strict boundaries while ordinary objects strip unknown fields', () => {
  const schema = mutableStruct({ nested: strictStruct({ name: Schema.String }) })
  expect(decode(schema, { nested: { name: 'valid' }, extra: true })).toEqual({
    nested: { name: 'valid' },
  })
  expect(decodeResult(schema, { nested: { name: 'valid', extra: true } }).success).toBe(false)
})

it('rejects invalid dates rather than normalizing them', () => {
  const schema = isoDateTime(Schema.String)
  expect(decodeResult(schema, '2026-02-29T00:00:00Z').success).toBe(false)
  expect(decode(schema, '2024-02-29T00:00:00Z')).toBe('2024-02-29T00:00:00Z')
})

it('keeps registry invariants on the schema boundary', () => {
  expect(
    decodeResult(runtimeRegistrySchema, { version: 1, activeId: 'missing', profiles: [] }).success,
  ).toBe(false)
})

it('retains UUID version and variant validation', async () => {
  const { uuidSchema } = await import('./schema.js')
  for (const value of [
    '12345678-1234-0234-8234-123456789abc',
    '12345678-1234-9234-8234-123456789abc',
    '12345678-1234-4234-0234-123456789abc',
  ]) {
    expect(decodeResult(uuidSchema, value).success).toBe(false)
  }
  expect(decodeResult(uuidSchema, '12345678-1234-4234-8234-123456789abc').success).toBe(true)
  expect(decodeResult(uuidSchema, '00000000-0000-0000-0000-000000000000').success).toBe(true)
})
