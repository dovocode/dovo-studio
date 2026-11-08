import { expect, it } from 'vite-plus/test'
import { chromium } from 'playwright'
import { createServer } from 'node:http'
import type { BrowserProfile } from '@dovo/protocol'
import { RemoteBrowsers } from './browser.js'

it('sends DNT only for opted-in profiles and updates existing contexts after saving', async () => {
  let profiles: BrowserProfile[] = [
    { id: 'default', name: 'Default' },
    { id: 'work', name: 'Work', doNotTrack: true },
  ]
  const server = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ dnt: request.headers.dnt ?? null }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing HTTP fixture port')
  const url = `http://127.0.0.1:${address.port}/`
  const browsers = new RemoteBrowsers(undefined, () => profiles)
  Object.defineProperty(browsers, 'executable', {
    value: async () => ({ chromium, executablePath: chromium.executablePath() }),
  })
  const entries: Array<Awaited<ReturnType<(typeof browsers)['profile']>>> = []
  try {
    const defaultProfile = await browsers['profile']('default', false, true)
    entries.push(defaultProfile)
    const workProfile = await browsers['profile']('work', false, true)
    entries.push(workProfile)
    const normal = await defaultProfile.context.newPage()
    const work = await workProfile.context.newPage()
    const read = async (page: typeof normal) => {
      const response = await page.goto(url)
      if (!response) throw new Error('Missing HTTP response')
      return response.json()
    }
    expect(await read(normal)).toEqual({ dnt: null })
    expect(await read(work)).toEqual({ dnt: '1' })
    expect(await work.evaluate(async () => (await fetch('/subresource')).json())).toEqual({
      dnt: '1',
    })
    profiles = [
      { id: 'default', name: 'Default', doNotTrack: true },
      { id: 'work', name: 'Work', doNotTrack: false },
    ]
    await browsers.refreshProfiles()
    expect(await read(normal)).toEqual({ dnt: '1' })
    expect(await read(work)).toEqual({ dnt: null })
  } finally {
    for (const entry of entries) await entry.release()
    await browsers.dispose()
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    )
  }
}, 30000)
