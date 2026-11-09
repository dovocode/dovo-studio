import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'

const require = createRequire(new URL('../apps/desktop/package.json', import.meta.url))
const directory = await mkdtemp(join(tmpdir(), 'dovo-unload-native-'))
try {
  await build({
    entryPoints: ['apps/desktop/electron/window-unload.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    outfile: join(directory, 'unload.cjs'),
  })
  await writeFile(
    join(directory, 'main.cjs'),
    `
const assert=require('node:assert/strict');const {app,BrowserWindow,dialog}=require('electron');
const {registerWindowUnload,closeStudioWindows}=require('./unload.cjs');
app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});
process.on('uncaughtException',error=>{console.error(error);app.exit(1)});
setTimeout(()=>{console.error('Native unload check timed out');app.exit(1)},30000);
app.on('window-all-closed',()=>{});
let decision=0;dialog.showMessageBoxSync=()=>decision;
(async()=>{await app.whenReady();
 const window=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false}});
 registerWindowUnload(window);
 await window.loadURL('data:text/html,<script>window.retained=42;window.addEventListener("beforeunload",event=>{event.preventDefault();event.returnValue=""})</script>');
 assert.equal(await closeStudioWindows(),false);assert.equal(window.isDestroyed(),false);
 assert.equal(await window.webContents.executeJavaScript('window.retained'),42);
 const cancelled=new Promise(resolve=>window.webContents.once('will-prevent-unload',()=>setImmediate(resolve)));
 window.webContents.reload();await cancelled;
 assert.equal(await window.webContents.executeJavaScript('window.retained'),42);
 decision=1;assert.equal(await closeStudioWindows(),true);assert.equal(window.isDestroyed(),true);
 console.log('Native Electron: cancelled close and reload preserve the renderer; explicit discard closes it.');app.exit(0);
})().catch(error=>{console.error(error);app.exit(1)});
`,
  )
  const code = await new Promise((resolve, reject) => {
    const child = spawn(require('electron'), ['--no-sandbox', join(directory, 'main.cjs')], {
      stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('exit', resolve)
  })
  if (code !== 0) process.exitCode = code ?? 1
} finally {
  await rm(directory, { recursive: true, force: true })
}
