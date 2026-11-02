import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'
import { _electron } from 'playwright'
import { createRequire } from 'node:module'

const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
const directory = await mkdtemp(join(tmpdir(), 'dovo-terminal-drop-'))
let app
try {
  const preload = join(directory, 'preload.cjs')
  await build({
    entryPoints: ['apps/desktop/electron/preload.ts'],
    outfile: preload,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
  })
  const main = join(directory, 'main.cjs')
  await writeFile(
    main,
    `const {app,BrowserWindow,ipcMain}=require('electron');ipcMain.on('app:info',event=>{event.returnValue={version:'test',channel:'dev'}});app.whenReady().then(()=>{const window=new BrowserWindow({webPreferences:{preload:${JSON.stringify(preload)},contextIsolation:true,sandbox:true}});window.loadURL('data:text/html,<input type="file" multiple>')});`,
  )
  const paths = [join(directory, "it's a file.txt"), join(directory, '日本語.txt')]
  for (const path of paths) await writeFile(path, 'fixture')
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  app = await _electron.launch({
    executablePath: require('electron'),
    args: ['--no-sandbox', main],
    env,
  })
  const page = await app.firstWindow()
  await page.locator('input').setInputFiles(paths)
  const drop = await build({
    entryPoints: ['packages/terminal/src/browser/drop.ts'],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'TerminalDrop',
  })
  await page.addScriptTag({ content: drop.outputFiles[0].text })
  const actual = await page.evaluate(() => {
    const data = new DataTransfer()
    for (const file of document.querySelector('input').files) data.items.add(file)
    return window.TerminalDrop.terminalDropPaths(data)
  })
  assert.deepEqual(actual, paths)
  assert.equal(
    await page.evaluate(() => window.dovoTerminalFilePath(new File(['memory'], 'memory.txt'))),
    '',
  )
  console.log(
    'Electron: actual sandboxed preload resolves native dropped files, spaces, apostrophes and Unicode paths.',
  )
} finally {
  await app?.close()
  await rm(directory, { recursive: true, force: true })
}
