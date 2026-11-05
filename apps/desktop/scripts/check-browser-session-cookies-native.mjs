#!/usr/bin/env node
/** Real Electron process restarts; a test cipher substitutes for unavailable CI OS keyrings. */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const desktop = fileURLToPath(new URL('../', import.meta.url))
const require = createRequire(join(desktop, 'package.json'))
const work = mkdtempSync(join(tmpdir(), 'dovo-cookie-restarts-'))
writeFileSync(
  join(work, 'main.ts'),
  `
import assert from 'node:assert/strict'
import { app, BrowserWindow, session, safeStorage } from 'electron'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createBrowserSessionCookies } from ${JSON.stringify(join(desktop, 'electron/browser-session-cookies.ts'))}
app.setPath('userData', ${JSON.stringify(join(work, 'user-data'))})
void (async () => {
  await app.whenReady()
  // Isolate cookie lifecycle coverage from desktop keyring availability. Production uses safeStorage.
  const key = createHash('sha256').update('throwaway-native-cookie-test').digest()
  safeStorage.isEncryptionAvailable = () => true
  safeStorage.getSelectedStorageBackend = () => 'gnome_libsecret'
  safeStorage.encryptString = (text: string) => {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted])
  }
  safeStorage.decryptString = (data: Buffer) => {
    const decipher = createDecipheriv('aes-256-gcm', key, data.subarray(0, 12))
    decipher.setAuthTag(data.subarray(12, 28))
    return Buffer.concat([decipher.update(data.subarray(28)), decipher.final()]).toString('utf8')
  }
  const sessionCookies = createBrowserSessionCookies()
  const attach = (profile: Electron.Session) => sessionCookies(profile, () => true)
  const profile = session.fromPartition('persist:dovo-browser-workspace:work')
  const path = join(profile.storagePath!, 'dovo-session-cookies.enc')
  await attach(profile)
  const phase = process.env.COOKIE_PHASE
  const waitFor = async (check: () => boolean) => {
    const deadline = Date.now() + 5000
    while (!check()) {
      if (Date.now() > deadline) throw new Error('Cookie change was not persisted')
      await new Promise(resolve => setTimeout(resolve, 10))
    }
  }
  if (phase === 'seed') {
    const window = new BrowserWindow({show:false,webPreferences:{session:profile}})
    await window.loadURL('about:blank')
    await profile.cookies.set({url:'http://127.0.0.1/',name:'login',value:'restart-test',httpOnly:true,sameSite:'lax'})
    await waitFor(() => existsSync(path))
    assert.equal(readFileSync(path).includes(Buffer.from('restart-test')), false)
    const cookie = (await profile.cookies.get({name:'login'}))[0]!
    assert.equal(cookie.session, true)
    assert.equal(cookie.hostOnly, true)
    window.destroy()
    assert.equal((await profile.cookies.get({name:'login'})).length, 1, 'Closing the last tab retains its session')
    const privateProfile = session.fromPartition('dovo-browser-workspace:private-test')
    await attach(privateProfile)
    await privateProfile.cookies.set({url:'http://127.0.0.1/',name:'private',value:'private'})
  } else if (phase === 'logout') {
    const cookies = await profile.cookies.get({name:'login'})
    assert.equal(cookies.length, 1, 'Session cookie must survive a full Electron restart')
    assert.equal(cookies[0]!.session, true)
    assert.equal(cookies[0]!.httpOnly, true)
    assert.equal(cookies[0]!.hostOnly, true)
    assert.equal(cookies[0]!.sameSite, 'lax')
    const other = session.fromPartition('persist:dovo-browser-workspace:other')
    await attach(other)
    assert.equal((await other.cookies.get({})).length, 0)
    assert.equal((await session.fromPartition('dovo-browser-workspace:private-test').cookies.get({})).length, 0)
    await profile.clearStorageData({storages:['cookies']})
    await waitFor(() => !existsSync(path))
  } else {
    assert.equal((await profile.cookies.get({})).length, 0, 'Clearing cookies must survive restart')
  }
  await profile.cookies.flushStore()
  app.quit()
})().catch(error => {console.error(error);app.exit(1)})
`,
)
await build({
  entryPoints: [join(work, 'main.ts')],
  outfile: join(work, 'main.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  external: ['electron'],
})
const electron = require('electron')
const display = process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY
try {
  for (const phase of ['seed', 'logout', 'verify']) {
    const child = spawnSync(
      display ? 'xvfb-run' : electron,
      [...(display ? ['-a', electron] : []), join(work, 'main.cjs')],
      {
        env: { ...process.env, COOKIE_PHASE: phase },
        encoding: 'utf8',
        timeout: 30000,
      },
    )
    if (child.status !== 0)
      throw new Error(`${phase}: ${child.error?.message ?? ''}\n${child.stderr}\n${child.stdout}`)
  }
  console.log(
    'Native session cookies passed: process restart, encryption, logout, profiles and private browsing.',
  )
} finally {
  rmSync(work, { recursive: true, force: true })
}
