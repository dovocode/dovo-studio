import { describe, expect, it } from 'vitest'

import { ExtensionHost } from './extension-host'

describe('ExtensionHost', () => {
  it('activates extensions by event and exposes contributed commands', async () => {
    const host = new ExtensionHost()
    host.register({
      manifest: {
        id: 'test.commands',
        name: 'Test Commands',
        version: '0.0.0',
        activationEvents: ['onCommand:test.echo'],
      },
      activate: (context) => {
        context.commands.registerCommand('test.echo', (value) => value)
      },
    })

    await host.activateByEvent('onCommand:test.echo')

    const info = host.get('test.commands')
    expect(info?.state).toBe('active')
    await expect(host.executeCommand<string>('test.echo', 'hello')).resolves.toBe('hello')
    expect(host.list()).toEqual([expect.objectContaining({ id: 'test.commands', state: 'active' })])
  })
})

it('shares pending activation and waits before disposal', async () => {
  const host = new ExtensionHost()
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let activated = 0,
    disposed = 0
  host.register({
    manifest: { id: 'lazy', name: 'Lazy', version: '1' },
    activate: async (context) => {
      activated++
      await gate
      context.subscriptions.push({
        dispose: () => {
          disposed++
        },
      })
    },
  })
  const first = host.activate('lazy'),
    second = host.activate('lazy')
  let finished = false
  void second.then(() => {
    finished = true
  })
  await Promise.resolve()
  expect(finished).toBe(false)
  const disposal = host.dispose()
  release()
  await Promise.all([first, second, disposal])
  expect(activated).toBe(1)
  expect(disposed).toBe(1)
  expect(host.get('lazy')?.state).toBe('inactive')
})

it('keeps extension state isolated and retains it across activation', async () => {
  const host = new ExtensionHost()
  host.register({
    manifest: { id: 'one', name: 'One', version: '1' },
    activate: (context) => {
      context.state.set('value', 1)
    },
  })
  host.register({
    manifest: { id: 'two', name: 'Two', version: '1' },
    activate: (context) => {
      expect(context.state.get('value')).toBeUndefined()
    },
  })
  await host.activate('one')
  await host.activate('two')
})
