import { expect, it } from 'vite-plus/test'
import { requireLocalStudioUI } from './local-ui.js'
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
