import { expect, it } from 'vite-plus/test'
import { requireLocalStudioUI, requireStudioPeerRegistration } from './local-ui.js'
it('restricts UI registration and control to actual loopback peers', () => {
  for (const address of ['127.0.0.1', '127.0.0.2', '::1', '::ffff:127.0.0.1'])
    expect(() => requireLocalStudioUI(address)).not.toThrow()
  for (const address of [
    undefined,
    '192.168.1.2',
    '100.64.0.2',
    '10.0.0.2',
    '::ffff:192.168.1.2',
    '::',
    '127.example.com',
  ])
    expect(() => requireLocalStudioUI(address)).toThrow('only on this machine')
})

it('allows remote pairing publication only when enabled without changing local UI access', () => {
  for (const address of ['192.168.1.2', '100.64.0.2', undefined]) {
    expect(() => requireStudioPeerRegistration(address, false)).toThrow('Access paired computers')
    expect(requireStudioPeerRegistration(address, true)).toBe('remote')
    expect(() => requireLocalStudioUI(address)).toThrow('only on this machine')
  }
  expect(requireStudioPeerRegistration('127.0.0.1', false)).toBe('local')
})
