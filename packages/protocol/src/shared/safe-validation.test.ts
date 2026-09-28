import { expect, it } from 'vitest'
import { Schema } from 'effect'
import { decodeResult, safeValidationIssues, safeValidationMessage } from './schema'
it('identifies declared fields and expected primitive types without submitted values', () => {
  const result = decodeResult(Schema.Struct({ name: Schema.String, enabled: Schema.Boolean }), {
    name: { key: 'secret' },
  })
  if (result.success) throw new Error('Expected invalid input')
  expect(safeValidationIssues(result.error)).toEqual([
    { path: 'name', code: 'invalid', message: 'Enter text.' },
    { path: 'enabled', code: 'required', message: 'This field is required.' },
  ])
  expect(safeValidationMessage(result.error)).not.toContain('secret')
})
it('hides dynamic record keys, excess keys and refinement diagnostic messages', () => {
  const schema = Schema.Struct({
    values: Schema.Record({ key: Schema.String, value: Schema.Number }),
    code: Schema.String.pipe(Schema.filter(() => false, { message: () => 'secret-in-refinement' })),
  }).annotations({ parseOptions: { onExcessProperty: 'error' } })
  const result = decodeResult(schema, {
    values: { 'secret-key': 'secret-value' },
    code: 'secret-code',
    'secret-excess': 'secret',
  })
  if (result.success) throw new Error('Expected invalid input')
  const message = safeValidationMessage(result.error)
  expect(message).not.toContain('secret')
  expect(message).toContain('values.[entry]')
})
