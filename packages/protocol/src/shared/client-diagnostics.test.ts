import { expect, it } from 'vite-plus/test'
import { clientDiagnostic, diagnosticMessage } from './client-diagnostics'
it('removes credentials and URL query/fragment from copyable diagnostics', () => {
  const value = diagnosticMessage(
    new Error(
      'Failed http://user:pass@computer:4321/api?token=private#secret Bearer abc123 password="private words" api_key=key123 "access_token":"json-secret"',
    ),
  )
  expect(value).toContain('http://computer:4321/api')
  for (const secret of ['user:pass', 'private', 'abc123', 'key123', '#secret', 'json-secret'])
    expect(value).not.toContain(secret)
})
it('includes a bounded error, a stable identifier and only supplied context', () => {
  const value = clientDiagnostic('x'.repeat(3000), { appVersion: '1.0', surface: 'mobile' })
  expect(value.id).toBeTruthy()
  expect(Number.isFinite(Date.parse(value.at))).toBe(true)
  expect(value.context).toEqual({ appVersion: '1.0', surface: 'mobile' })
  expect(value.error).toHaveLength(2000)
})
