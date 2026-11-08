import { expect, it } from 'vite-plus/test'
import { documentPipDisallowsReturn } from './browser-document-pip-policy'

it.each(['teams.microsoft.com', 'teams.cloud.microsoft', 'teams.live.com'])(
  'hides return-to-tab only in Teams PiP at %s',
  (host) => {
    expect(documentPipDisallowsReturn('', new URL(`https://${host}/v2/call`))).toBe(true)
    expect(documentPipDisallowsReturn('dovo-disallow-return=0', new URL(`https://${host}`))).toBe(
      true,
    )
  },
)
it('retains the other sites return control and their explicit opt-out', () => {
  for (const site of [
    'https://meet.google.com/call',
    'https://teams.microsoft.com.evil.example',
    'http://localhost/call',
  ]) {
    expect(documentPipDisallowsReturn('', new URL(site))).toBe(false)
    expect(
      documentPipDisallowsReturn('width=420,dovo-disallow-return=1,height=280', new URL(site)),
    ).toBe(true)
  }
})
