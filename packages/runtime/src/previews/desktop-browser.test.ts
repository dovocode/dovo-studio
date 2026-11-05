import { expect, it } from 'vite-plus/test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocketServer } from 'ws'
import { desktopBrowserCommand, desktopBrowserList, formatAxSnapshot } from './desktop-browser.js'

it('formats accessibility trees as readable bounded snapshots', () => {
  const snapshot = formatAxSnapshot([
    {
      nodeId: '1',
      role: { value: 'RootWebArea' },
      name: { value: 'Example' },
      childIds: ['2', '3'],
    },
    { nodeId: '2', role: { value: 'button' }, name: { value: 'Save  now' } },
    { nodeId: '3', role: { value: 'generic' }, childIds: ['4'] },
    { nodeId: '4', role: { value: 'link' }, name: { value: 'Docs' } },
    { nodeId: '5', ignored: true, role: { value: 'button' }, name: { value: 'Hidden' } },
  ])
  expect(snapshot).toBe('- RootWebArea "Example"\n  - button "Save now"\n  - link "Docs"')
})

it('lists and drives desktop workspace tabs through page-scoped CDP', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-desktop-browser-'))
  const token = 'a'.repeat(64)
  const sockets = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  const evaluated: string[] = []
  sockets.on('connection', (socket) => {
    socket.on('message', (raw) => {
      const command = JSON.parse(raw.toString()) as {
        id: number
        method: string
        params?: { expression?: string }
      }
      const reply = (result: unknown) => socket.send(JSON.stringify({ id: command.id, result }))
      if (command.method === 'Runtime.evaluate') {
        const expression = command.params?.expression ?? ''
        evaluated.push(expression)
        reply({
          result: {
            value: expression.includes('location.href')
              ? { url: 'https://example.com/', title: 'Example' }
              : true,
          },
        })
      } else if (command.method === 'Accessibility.getFullAXTree')
        reply({
          nodes: [
            {
              nodeId: '1',
              role: { value: 'RootWebArea' },
              name: { value: 'Example' },
              childIds: ['2'],
            },
            { nodeId: '2', role: { value: 'heading' }, name: { value: 'Hello desktop' } },
          ],
        })
      else if (command.method === 'Page.captureScreenshot') reply({ data: 'iVBORw0KGgo=' })
      else reply({})
    })
  })
  await new Promise<void>((resolve) => sockets.once('listening', resolve))
  const address = sockets.address()
  if (!address || typeof address === 'string') throw new Error('Missing CDP test address')
  const previous = {
    distribution: process.env.DOVO_RELEASE_DISTRIBUTION,
    database: process.env.DOVO_DATABASE_PATH,
  }
  process.env.DOVO_RELEASE_DISTRIBUTION = 'desktop'
  process.env.DOVO_DATABASE_PATH = join(directory, 'runtime.sqlite')
  writeFileSync(
    join(directory, 'desktop-browser-host.json'),
    JSON.stringify({
      pid: process.pid,
      targets: [
        {
          taskId: 'studio:browser',
          tabId: 'tab-1',
          profileId: 'work',
          endpoint: `ws://127.0.0.1:${address.port}/${token}/devtools/page/1`,
        },
        {
          taskId: 'studio:browser',
          tabId: 'tab-private',
          profileId: 'private-123e4567-e89b-12d3-a456-426614174000',
          endpoint: `ws://127.0.0.1:${address.port}/${token}/devtools/page/2`,
        },
      ],
    }),
  )
  try {
    const listed = await desktopBrowserList()
    expect(listed.map((tab) => tab.id)).toEqual(['desktop:tab-1'])
    const result = await desktopBrowserCommand(
      'desktop:tab-1',
      { action: 'click', selector: '#save' },
      () => {},
    )
    expect(result).toMatchObject({
      ok: true,
      url: 'https://example.com/',
      title: 'Example',
      image: 'iVBORw0KGgo=',
    })
    expect('snapshot' in result && result.snapshot).toContain('Hello desktop')
    expect(evaluated.some((expression) => expression.includes('querySelector("#save")'))).toBe(true)
    await expect(
      desktopBrowserCommand(
        'desktop:tab-1',
        { action: 'click', selector: 'role=button' },
        () => {},
      ),
    ).rejects.toThrow('CSS selectors')
    await expect(
      desktopBrowserCommand('desktop:missing', { action: 'snapshot' }, () => {}),
    ).rejects.toThrow('Open the tab in the desktop Browser workspace')
  } finally {
    process.env.DOVO_RELEASE_DISTRIBUTION = previous.distribution
    process.env.DOVO_DATABASE_PATH = previous.database
    sockets.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
