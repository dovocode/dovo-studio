import { expect, it } from 'vite-plus/test'
import { RuntimeStartupError } from './index.js'

it('keeps the startup operation and cause when a component throws a plain record', () => {
  const cause = { code: 'ENOENT' }
  Object.setPrototypeOf(cause, null)
  const error = new RuntimeStartupError({ operation: 'service initialization', cause })
  expect(error.message).toContain('Runtime service initialization failed')
  expect(error.message).toContain('ENOENT')
})
