import { expect, it } from 'vite-plus/test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RemoteBrowsers } from './browser.js'

it('targets keyboard and scroll input independently of the active element', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dovo-agent-targeted-'))
  const browsers = new RemoteBrowsers(directory)
  const call = (command: Parameters<RemoteBrowsers['agentCommand']>[1]) =>
    browsers.agentCommand('targeted', command, () => {})
  const read = async (script: string) => {
    const state = await call({ action: 'evaluate', script })
    return 'result' in state ? state.result : undefined
  }
  try {
    await call({
      action: 'evaluate',
      script: `document.body.innerHTML = '<label>Name<input id="name" value="Name"></label><input id="other" value="Other"><div id="scroll" style="height:80px;overflow:auto"><div style="height:2000px">Results</div></div><div style="height:3000px"></div>'`,
    })
    const initial = await call({ action: 'snapshot' })
    const line =
      'snapshot' in initial &&
      initial.snapshot.split('\n').find((line) => line.includes('- textbox "Name"'))
    const ref = line && /\[ref=([^\]]+)\]/.exec(line)?.[1]
    if (!ref) throw new Error('Missing Name reference')
    await read('document.querySelector("#other").focus()')
    await call({ action: 'key', selector: `ref=${ref}`, key: 'End' })
    await call({ action: 'key', selector: '#name', key: '!' })
    expect(await read('document.querySelector("#name").value')).toBe('Name!')
    expect(await read('document.querySelector("#other").value')).toBe('Other')
    await expect(call({ action: 'key', selector: `ref=${ref}`, key: 'X' })).rejects.toThrow('stale')
    await call({ action: 'scroll', selector: '#scroll', deltaY: 200 })
    expect(await read('document.querySelector("#scroll").scrollTop')).toBe(200)
    await call({ action: 'scroll', deltaY: 200 })
    expect(await read('window.scrollY')).toBeGreaterThan(0)
    await expect(call({ action: 'scroll', selector: `ref=${ref}`, deltaY: 100 })).rejects.toThrow(
      'stale',
    )
  } finally {
    await browsers.dispose()
    await rm(directory, { recursive: true, force: true })
  }
}, 30000)

it('uses managed Chromium to inspect and interact with HTTP pages in isolated task sessions', async () => {
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html')
    if (request.url === '/cookies') {
      response.end(`<h1>${request.headers.cookie ?? 'No cookies'}</h1>`)
      return
    }
    if (request.url === '/frame') {
      response.end('<label>Frame name<input></label>')
      return
    }
    response.end(
      `<title>Agent browser test</title><h1>Hello browser</h1><label>Name<input id="name"></label><button onclick="document.querySelector('h1').textContent=document.querySelector('input').value">Save</button>
      <a href="/cookies">Cookies</a><label><input type="checkbox" checked>Active</label>
      <label>Plan<select><option value="free">Free</option><option value="pro" selected>Pro</option></select></label>
      <label>Password<input type="password" value="secret-password"></label>
      <input type="hidden" value="hidden-secret"><button hidden>Hidden action</button>
      <fieldset disabled><label>Locked<input value="locked"></label></fieldset>
      <iframe title="Details" src="/frame"></iframe>
      <script>document.cookie='test=isolated'</script>`,
    )
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing test server address')
  const directory = await mkdtemp(join(tmpdir(), 'dovo-agent-browser-'))
  const browsers = new RemoteBrowsers(directory)
  const authorize = () => {}
  try {
    const url = `http://127.0.0.1:${address.port}`
    const page = await browsers.agentCommand('task-a', { action: 'navigate', url }, authorize)
    expect(page).toMatchObject({ title: 'Agent browser test', url: `${url}/` })
    expect('snapshot' in page && page.snapshot).toContain('Hello browser')
    expect(page).not.toHaveProperty('image')
    expect(page).toMatchObject({
      elementsTruncated: false,
      snapshotTruncated: false,
      elements: expect.arrayContaining([
        expect.objectContaining({ selector: '#name', name: 'Name', value: '' }),
        expect.objectContaining({ name: 'Active', checked: true }),
        expect.objectContaining({ name: 'Cookies', href: `${url}/cookies` }),
        expect.objectContaining({ name: 'Locked', disabled: true, value: 'locked' }),
        expect.objectContaining({
          name: 'Plan',
          value: 'pro',
          options: [
            { label: 'Free', value: 'free', selected: false, disabled: false },
            { label: 'Pro', value: 'pro', selected: true, disabled: false },
          ],
        }),
      ]),
    })
    expect(JSON.stringify(page)).not.toContain('secret-password')
    expect(JSON.stringify(page)).not.toContain('hidden-secret')
    expect(JSON.stringify(page)).not.toContain('Hidden action')
    expect(await browsers.activeMedia('missing')).toBe(false)
    expect(await browsers.activeMedia('agent-browser:task-a')).toBe(false)
    await browsers.agentCommand(
      'task-a',
      {
        action: 'evaluate',
        script: `(() => { const video=document.createElement('video'); Object.defineProperty(video,'paused',{value:false}); Object.defineProperty(video,'ended',{value:false}); video.id='playing'; document.body.append(video) })()`,
      },
      authorize,
    )
    expect(await browsers.activeMedia('agent-browser:task-a')).toBe(true)
    await browsers.agentCommand(
      'task-a',
      { action: 'evaluate', script: 'document.getElementById("playing").remove()' },
      authorize,
    )
    expect(await browsers.activeMedia('agent-browser:task-a')).toBe(false)
    const screenshot = await browsers.agentCommand('task-a', { action: 'screenshot' }, authorize)
    expect(
      'image' in screenshot && Buffer.from(screenshot.image, 'base64').subarray(1, 4).toString(),
    ).toBe('PNG')
    expect(screenshot).not.toHaveProperty('elements')
    await browsers.agentCommand(
      'task-a',
      { action: 'fill', selector: '#name', text: 'Updated' },
      authorize,
    )
    const current = await browsers.agentCommand('task-a', { action: 'snapshot' }, authorize)
    const save =
      'elements' in current && current.elements.find((element) => element.name === 'Save')
    if (!save) throw new Error('Missing Save element')
    expect(current).toMatchObject({
      elements: expect.arrayContaining([
        expect.objectContaining({ selector: '#name', value: 'Updated' }),
      ]),
    })
    const clicked = await browsers.agentCommand(
      'task-a',
      { action: 'click', selector: save.selector },
      authorize,
    )
    expect('snapshot' in clicked && clicked.snapshot).toContain('Updated')
    const refLine =
      'snapshot' in clicked &&
      clicked.snapshot.split('\n').find((line) => line.includes('- textbox "Name"'))
    const nameRef = refLine && /\[ref=([^\]]+)\]/.exec(refLine)?.[1]
    if (!nameRef) throw new Error('Missing textbox reference')
    await expect(
      browsers.agentCommand(
        'task-b',
        { action: 'fill', selector: `ref=${nameRef}`, text: 'Wrong tab' },
        authorize,
      ),
    ).rejects.toThrow('stale')
    const refFilled = await browsers.agentCommand(
      'task-a',
      { action: 'fill', selector: `ref=${nameRef}`, text: 'From tree' },
      authorize,
    )
    expect(refFilled).toMatchObject({
      elements: expect.arrayContaining([
        expect.objectContaining({ name: 'Name', value: 'From tree' }),
      ]),
    })
    await expect(
      browsers.agentCommand(
        'task-a',
        { action: 'fill', selector: `ref=${nameRef}`, text: 'Old tree' },
        authorize,
      ),
    ).rejects.toThrow('stale')
    const frameLine =
      'snapshot' in refFilled &&
      refFilled.snapshot.split('\n').find((line) => line.includes('- textbox "Frame name"'))
    const frameRef = frameLine && /\[ref=([^\]]+)\]/.exec(frameLine)?.[1]
    if (!frameRef) throw new Error('Missing frame textbox reference')
    await browsers.agentCommand(
      'task-a',
      { action: 'fill', selector: `ref=${frameRef}`, text: 'Inside frame' },
      authorize,
    )
    expect(
      await browsers.agentCommand(
        'task-a',
        {
          action: 'evaluate',
          script: 'document.querySelector("iframe").contentDocument.querySelector("input").value',
        },
        authorize,
      ),
    ).toMatchObject({ result: 'Inside frame' })
    const evaluated = await browsers.agentCommand(
      'task-a',
      {
        action: 'evaluate',
        script:
          '(async () => { await Promise.resolve(); document.querySelector("h1").textContent = "Script updated"; return { title: document.title, node: typeof process, text: document.querySelector("h1").textContent } })()',
      },
      authorize,
    )
    expect(evaluated).toMatchObject({
      result: { title: 'Agent browser test', node: 'undefined', text: 'Script updated' },
    })
    expect(evaluated).not.toHaveProperty('snapshot')
    expect(evaluated).not.toHaveProperty('image')
    expect(evaluated).not.toHaveProperty('elements')
    await expect(
      browsers.agentCommand(
        'task-a',
        { action: 'evaluate', script: '(() => { throw new Error("Script failed") })()' },
        authorize,
      ),
    ).rejects.toThrow('Script failed')
    await expect(
      browsers.agentCommand(
        'task-a',
        { action: 'evaluate', script: 'new Promise(() => {})' },
        authorize,
      ),
    ).rejects.toThrow('10 second execution limit')
    await expect(
      browsers.agentCommand(
        'task-a',
        { action: 'evaluate', script: '(() => { while (true) {} })()' },
        authorize,
      ),
    ).rejects.toThrow(/execution|timed out|10 second/i)
    const recovered = await browsers.agentCommand(
      'task-a',
      { action: 'evaluate', script: '6 * 7' },
      authorize,
    )
    expect(recovered).toMatchObject({ result: 42 })
    const other = await browsers.agentCommand('task-b', { action: 'snapshot' }, authorize)
    expect(other).toMatchObject({ url: 'about:blank' })
    const ownCookies = await browsers.agentCommand(
      'task-a',
      { action: 'navigate', url: `${url}/cookies` },
      authorize,
    )
    expect('snapshot' in ownCookies && ownCookies.snapshot).toContain('test=isolated')
    const otherCookies = await browsers.agentCommand(
      'task-b',
      { action: 'navigate', url: `${url}/cookies` },
      authorize,
    )
    expect('snapshot' in otherCookies && otherCookies.snapshot).toContain('No cookies')
    expect(await readdir(directory)).toEqual([])
    await expect(
      browsers.agentCommand('task-a', { action: 'navigate', url: 'file:///etc/passwd' }, authorize),
    ).rejects.toThrow('HTTP or HTTPS')
    await expect(
      browsers.agentCommand('task-a', { action: 'snapshot' }, () => {
        throw new Error('Revoked')
      }),
    ).rejects.toThrow('Revoked')
    await browsers.closeTask('task-a')
    const reopened = await browsers.agentCommand('task-a', { action: 'snapshot' }, authorize)
    expect(reopened).toMatchObject({ url: 'about:blank' })
    expect(await browsers.agentCommand('task-a', { action: 'close' }, authorize)).toEqual({
      ok: true,
    })
  } finally {
    await browsers.dispose()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
    await rm(directory, { recursive: true, force: true })
  }
}, 60000)

it('exposes live Browser workspace tabs to Studio Tools by tab alias, never private tabs', async () => {
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'text/html')
    response.end('<title>Workspace tab</title><h1>Shared page</h1>')
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing test server address')
  const directory = await mkdtemp(join(tmpdir(), 'dovo-workspace-browser-'))
  const browsers = new RemoteBrowsers(directory)
  const authorize = () => {}
  const url = `http://127.0.0.1:${address.port}`
  const resource = JSON.stringify(['studio:browser', 'tab-work', 'work'])
  const privateProfile = 'private-123e4567-e89b-12d3-a456-426614174000'
  const privateResource = JSON.stringify(['studio:browser', 'tab-private', privateProfile])
  try {
    await browsers.open(resource, 'studio:browser', 'work', url)
    await browsers.open(privateResource, 'studio:browser', privateProfile, url)
    const sessions = await browsers.studioList()
    expect(sessions).toContainEqual(
      expect.objectContaining({
        id: 'workspace:tab-work',
        kind: 'workspace',
        tabId: 'tab-work',
        profileId: 'work',
        title: 'Workspace tab',
      }),
    )
    expect(sessions.some((session) => session.tabId === 'tab-private')).toBe(false)
    const snapshot = await browsers.agentCommand(
      'task-a',
      { action: 'snapshot' },
      authorize,
      'workspace:tab-work',
    )
    expect('snapshot' in snapshot && snapshot.snapshot).toContain('Shared page')
    expect(await browsers.studioList()).toContainEqual(
      expect.objectContaining({ id: 'workspace:tab-work', agentActiveAt: expect.any(String) }),
    )
    expect(await browsers.studioLogs('workspace:tab-work')).toEqual({ entries: [] })
    await expect(
      browsers.agentCommand('task-a', { action: 'snapshot' }, authorize, 'workspace:tab-private'),
    ).rejects.toThrow('Private browser tabs')
    await expect(browsers.studioLogs('workspace:tab-private')).rejects.toThrow(
      'Private browser tabs',
    )
    await expect(
      browsers.agentCommand('task-a', { action: 'snapshot' }, authorize, 'workspace:missing'),
    ).rejects.toThrow('open it in Studio first')
  } finally {
    await browsers.dispose()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
    await rm(directory, { recursive: true, force: true })
  }
}, 60000)
