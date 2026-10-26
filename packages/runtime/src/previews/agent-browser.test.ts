import { expect, it } from 'vite-plus/test'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RemoteBrowsers } from './browser.js'

it('uses managed Chromium to inspect and interact with HTTP pages in isolated task sessions', async () => {
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'text/html')
    if (request.url === '/cookies') {
      response.end(`<h1>${request.headers.cookie ?? 'No cookies'}</h1>`)
      return
    }
    response.end(
      `<title>Agent browser test</title><h1>Hello browser</h1><label>Name<input id="name"></label><button onclick="document.querySelector('h1').textContent=document.querySelector('input').value">Save</button><script>document.cookie='test=isolated'</script>`,
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
    expect('image' in page && Buffer.from(page.image, 'base64').subarray(1, 4).toString()).toBe(
      'PNG',
    )
    await browsers.agentCommand(
      'task-a',
      { action: 'fill', selector: '#name', text: 'Updated' },
      authorize,
    )
    const clicked = await browsers.agentCommand(
      'task-a',
      { action: 'click', selector: 'text=Save' },
      authorize,
    )
    expect('snapshot' in clicked && clicked.snapshot).toContain('Updated')
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
    expect('snapshot' in evaluated && evaluated.snapshot).toContain('Script updated')
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
