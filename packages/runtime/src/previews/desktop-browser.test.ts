import { expect, it } from 'vite-plus/test'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WebSocket, WebSocketServer } from 'ws'
import { chromium } from 'playwright'
import { Schema } from 'effect'
import { decode, mutableStruct } from '@dovo/protocol'
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

it('uses real Chromium page CDP to read a tree and target elements without screenshots', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-desktop-cdp-live-'))
  const profile = join(directory, 'chromium')
  const context = await chromium.launchPersistentContext(profile, {
    headless: true,
    args: ['--remote-debugging-port=0'],
  })
  const page = context.pages()[0]!
  const port = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]
  const discovered = decode(
    Schema.Array(mutableStruct({ type: Schema.String, webSocketDebuggerUrl: Schema.String })),
    await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(),
  )
  const upstreamURL = discovered.find((target) => target.type === 'page')?.webSocketDebuggerUrl
  if (!upstreamURL) throw new Error('Missing Chromium page endpoint')
  const proxy = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  await new Promise<void>((resolve) => proxy.once('listening', resolve))
  const address = proxy.address()
  if (!address || typeof address === 'string') throw new Error('Missing proxy address')
  const methods: string[] = []
  proxy.on('connection', (client) => {
    const upstream = new WebSocket(upstreamURL)
    client.on('message', (raw) => {
      const { method } = decode(
        mutableStruct({ method: Schema.String }),
        JSON.parse(
          (Array.isArray(raw)
            ? Buffer.concat(raw)
            : Buffer.isBuffer(raw)
              ? raw
              : Buffer.from(raw)
          ).toString('utf8'),
        ),
      )
      methods.push(method)
      if (/^(Browser|Target)\./.test(method)) throw new Error('Expected page-scoped CDP only')
      if (upstream.readyState === WebSocket.OPEN)
        upstream.send(
          (Array.isArray(raw)
            ? Buffer.concat(raw)
            : Buffer.isBuffer(raw)
              ? raw
              : Buffer.from(raw)
          ).toString('utf8'),
        )
      else
        upstream.once('open', () =>
          upstream.send(
            (Array.isArray(raw)
              ? Buffer.concat(raw)
              : Buffer.isBuffer(raw)
                ? raw
                : Buffer.from(raw)
            ).toString('utf8'),
          ),
        )
    })
    upstream.on('message', (raw) => {
      if (client.readyState === WebSocket.OPEN) client.send(raw)
    })
    client.once('close', () => upstream.close())
    upstream.once('error', () => client.close())
  })
  const previousDistribution = process.env.DOVO_RELEASE_DISTRIBUTION
  const previousDatabase = process.env.DOVO_DATABASE_PATH
  process.env.DOVO_RELEASE_DISTRIBUTION = 'desktop'
  process.env.DOVO_DATABASE_PATH = join(directory, 'runtime.sqlite')
  const hostPath = join(directory, 'desktop-browser-host.json')
  const host = {
    pid: process.pid,
    targets: [
      {
        taskId: 'studio:browser',
        tabId: 'live',
        profileId: 'work',
        endpoint: `ws://127.0.0.1:${address.port}/${'a'.repeat(64)}/devtools/page/1`,
      },
    ],
  }
  writeFileSync(hostPath, JSON.stringify(host))
  const call = (command: Parameters<typeof desktopBrowserCommand>[1]) =>
    desktopBrowserCommand('desktop:live', command, () => {})
  const refFor = (state: Awaited<ReturnType<typeof call>>, role: string, name: string) => {
    const line =
      'snapshot' in state &&
      state.snapshot.split('\n').find((line) => line.includes(`- ${role} ${JSON.stringify(name)}`))
    const ref = line && /\[ref=([^\]]+)\]/.exec(line)?.[1]
    if (!ref) throw new Error(`Missing ref for ${name}`)
    return `ref=${ref}`
  }
  try {
    await page.setContent(
      '<main><h1>Live page</h1><label>Name<input id="name"></label><label>Password<input type="password" value="secret-password"></label><button onclick="document.querySelector(\'output\').textContent=document.querySelector(\'input\').value">Save</button><button>Save</button><output></output></main>',
    )
    const initial = await call({ action: 'snapshot' })
    expect(initial).not.toHaveProperty('image')
    expect(JSON.stringify(initial)).not.toContain('secret-password')
    expect(initial).toMatchObject({
      elements: expect.arrayContaining([
        expect.objectContaining({ selector: '#name', name: 'Name' }),
      ]),
    })
    const nameRef = refFor(initial, 'textbox', 'Name')
    const filled = await call({ action: 'fill', selector: nameRef, text: 'Dominic' })
    expect(await page.locator('#name').inputValue()).toBe('Dominic')
    expect(await page.locator('#name').evaluate((input) => input === document.activeElement)).toBe(
      true,
    )
    await expect(call({ action: 'fill', selector: nameRef, text: 'Old' })).rejects.toThrow('stale')
    await expect(call({ action: 'click', selector: 'button' })).rejects.toThrow(
      'Expected one element',
    )
    const saved = await call({ action: 'click', selector: refFor(filled, 'button', 'Save') })
    expect(await page.locator('output').textContent()).toBe('Dominic')
    expect(saved).not.toHaveProperty('image')
    await page.locator('input[type="password"]').focus()
    const keyed = await call({
      action: 'key',
      selector: refFor(saved, 'textbox', 'Name'),
      key: '!',
    })
    expect(await page.locator('#name').inputValue()).toBe('Dominic!')
    await expect(call({ action: 'key', selector: nameRef, key: 'X' })).rejects.toThrow('stale')
    await call({ action: 'key', selector: '#name', key: 'Backspace' })
    expect(await page.locator('#name').inputValue()).toBe('Dominic')
    await call({ action: 'key', selector: '#name', key: 'Space' })
    expect(await page.locator('#name').inputValue()).toBe('Dominic ')
    await call({ action: 'key', selector: '#name', key: 'Backspace' })
    await page.evaluate(() => {
      const region = document.createElement('div')
      region.id = 'scroll'
      region.style.cssText = 'height:80px;overflow:auto'
      region.innerHTML = '<div style="height:2000px">Results</div>'
      document.body.append(region)
      document.body.style.height = '3000px'
    })
    await call({ action: 'scroll', selector: '#scroll', deltaY: 200 })
    expect(await page.locator('#scroll').evaluate((element) => element.scrollTop)).toBe(200)
    await call({ action: 'scroll', deltaY: 200 })
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
    await expect(
      call({ action: 'scroll', selector: refFor(keyed, 'textbox', 'Name'), deltaY: 100 }),
    ).rejects.toThrow('stale')
    await page.evaluate(() => {
      const select = document.createElement('select')
      select.id = 'large-select'
      for (let index = 0; index < 60; index++)
        select.add(new Option(`Choice ${index}`, String(index)))
      document.body.append(select)
      for (let index = 0; index < 170; index++) {
        const button = document.createElement('button')
        button.textContent = `Action ${index}`
        document.body.append(button)
      }
      const heading = document.createElement('h2')
      heading.textContent = 'Long content '.repeat(4000)
      document.body.append(heading)
    })
    const large = await call({ action: 'snapshot' })
    expect(large).toMatchObject({
      snapshotTruncated: true,
      elementsTruncated: true,
      elements: expect.arrayContaining([
        expect.objectContaining({ selector: '#large-select', optionsTruncated: true }),
      ]),
    })
    expect('snapshot' in large && large.snapshot.length).toBeLessThanOrEqual(32000)
    expect('elements' in large && large.elements).toHaveLength(150)
    expect(
      'elements' in large &&
        large.elements.find((element) => element.selector === '#large-select')?.options,
    ).toHaveLength(50)
    const oldRef = refFor(large, 'textbox', 'Name')
    await page.evaluate(() => {
      location.hash = 'changed'
    })
    await expect(call({ action: 'fill', selector: oldRef, text: 'Old URL' })).rejects.toThrow(
      'stale',
    )
    const currentRef = refFor(await call({ action: 'snapshot' }), 'textbox', 'Name')
    await page.goto('about:blank?changed')
    await expect(
      call({ action: 'fill', selector: currentRef, text: 'Wrong page' }),
    ).rejects.toThrow(/stale|node|document/i)
    await page.evaluate(() => {
      for (let index = 0; index < 30; index++) {
        const input = document.createElement('input')
        input.value = 'x'.repeat(2000)
        document.body.append(input)
      }
    })
    const bounded = await call({ action: 'snapshot' })
    expect(bounded).toMatchObject({ elementsTruncated: true })
    expect('elements' in bounded && JSON.stringify(bounded.elements).length).toBeLessThanOrEqual(
      32000,
    )
    const data = await call({ action: 'evaluate', script: '({answer:42})' })
    expect(data).toMatchObject({ result: { answer: 42 } })
    expect(data).not.toHaveProperty('snapshot')
    expect(methods).not.toContain('Page.captureScreenshot')
    expect(await call({ action: 'screenshot' })).toHaveProperty('image')
    expect(methods.filter((method) => method === 'Page.captureScreenshot')).toHaveLength(1)
    host.targets[0]!.profileId = 'private-123e4567-e89b-12d3-a456-426614174000'
    writeFileSync(hostPath, JSON.stringify(host))
    await expect(call({ action: 'snapshot' })).rejects.toThrow('not found')
  } finally {
    if (previousDistribution === undefined) delete process.env.DOVO_RELEASE_DISTRIBUTION
    else process.env.DOVO_RELEASE_DISTRIBUTION = previousDistribution
    if (previousDatabase === undefined) delete process.env.DOVO_DATABASE_PATH
    else process.env.DOVO_DATABASE_PATH = previousDatabase
    for (const client of proxy.clients) client.terminate()
    await new Promise<void>((resolve) => proxy.close(() => resolve()))
    await context.close()
    rmSync(directory, { recursive: true, force: true })
  }
}, 30000)

it('lists and drives desktop workspace tabs through page-scoped CDP', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'dovo-desktop-browser-'))
  const token = 'a'.repeat(64)
  const sockets = new WebSocketServer({ host: '127.0.0.1', port: 0 })
  const evaluated: string[] = []
  sockets.on('connection', (socket) => {
    socket.on('message', (raw) => {
      const command = JSON.parse(
        (Array.isArray(raw)
          ? Buffer.concat(raw)
          : Buffer.isBuffer(raw)
            ? raw
            : Buffer.from(raw)
        ).toString('utf8'),
      ) as {
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
            value:
              expression.includes('querySelectorAll') && expression.includes('elementsTruncated')
                ? {
                    elements: [{ selector: '#save', tag: 'button', name: 'Save' }],
                    elementsTruncated: false,
                  }
                : expression.includes('location.href')
                  ? { url: 'https://example.com/', title: 'Example', document: 123 }
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
      elements: [{ selector: '#save', tag: 'button', name: 'Save' }],
    })
    expect('snapshot' in result && result.snapshot).toContain('Hello desktop')
    expect(result).not.toHaveProperty('image')
    expect(
      await desktopBrowserCommand('desktop:tab-1', { action: 'screenshot' }, () => {}),
    ).toEqual({
      ok: true,
      url: 'https://example.com/',
      title: 'Example',
      image: 'iVBORw0KGgo=',
    })
    expect(
      await desktopBrowserCommand(
        'desktop:tab-1',
        { action: 'evaluate', script: 'true' },
        () => {},
      ),
    ).toEqual({
      ok: true,
      url: 'https://example.com/',
      title: 'Example',
      result: true,
    })
    expect(evaluated.some((expression) => expression.includes('querySelectorAll("#save")'))).toBe(
      true,
    )
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
