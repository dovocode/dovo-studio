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
  await build({
    entryPoints: ['apps/desktop/electron/task-launcher.ts'],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    external: ['electron'],
    outfile: join(directory, 'launcher.cjs'),
  })
  await writeFile(
    join(directory, 'renderer.html'),
    '<html><body>Native launcher check</body></html>',
  )
  await writeFile(
    join(directory, 'preload.cjs'),
    "const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('openLauncher',()=>ipcRenderer.invoke('task-launcher:open'))",
  )
  await writeFile(
    join(directory, 'main.cjs'),
    `
const assert=require('node:assert/strict');const {app,BrowserWindow,dialog}=require('electron');
const {registerWindowUnload,closeStudioWindows}=require('./unload.cjs');
const {registerTaskLauncher}=require('./launcher.cjs');
const {join}=require('node:path');
app.setPath('userData',${JSON.stringify(join(directory, 'profile'))});
process.on('uncaughtException',error=>{console.error(error);app.exit(1)});
setTimeout(()=>{console.error('Native unload check timed out');app.exit(1)},30000);
app.on('window-all-closed',()=>{});
let decision=0;dialog.showMessageBoxSync=()=>decision;
(async()=>{await app.whenReady();
 const launcher=new BrowserWindow({show:false});
 let hidden=0;launcher.on('close',event=>{event.preventDefault();hidden++;launcher.hide()});
 await launcher.loadURL('data:text/html,Quick task');launcher.close();assert.equal(hidden,1);
 const window=new BrowserWindow({show:false,webPreferences:{contextIsolation:true,nodeIntegration:false}});
 registerWindowUnload(window);
 await window.loadURL('data:text/html,<script>window.retained=42;window.addEventListener("beforeunload",event=>{event.preventDefault();event.returnValue=""})</script>');
 assert.equal(await closeStudioWindows(),false);assert.equal(window.isDestroyed(),false);
 assert.equal(await window.webContents.executeJavaScript('window.retained'),42);
 const cancelled=new Promise(resolve=>window.webContents.once('will-prevent-unload',()=>setImmediate(resolve)));
 window.webContents.reload();await cancelled;
 assert.equal(await window.webContents.executeJavaScript('window.retained'),42);
 decision=1;assert.equal(await closeStudioWindows(),true);assert.equal(window.isDestroyed(),true);
 assert.equal(launcher.isDestroyed(),false);assert.equal(hidden,1);
 assert.equal(await closeStudioWindows(),true);launcher.destroy();
 const renderer=join(__dirname,'renderer.html'),preload=join(__dirname,'preload.cjs');
 const bridge=registerTaskLauncher(renderer,preload);
 const owner=new BrowserWindow({show:false,webPreferences:{preload,contextIsolation:true,nodeIntegration:false}});
 await owner.loadFile(renderer);await owner.webContents.executeJavaScript('window.openLauncher()');
 const panel=BrowserWindow.getAllWindows().find(item=>item!==owner);assert.ok(panel);
 panel.close();assert.equal(panel.isDestroyed(),false);
 // Match macOS updater ordering: close arrives before app.before-quit.
 bridge.setQuitting(true);const closing=new Promise(resolve=>panel.once('closed',resolve));panel.close();await closing;
 assert.equal(panel.isDestroyed(),true);
 bridge.setQuitting(false);await owner.webContents.executeJavaScript('window.openLauncher()');
 const recovered=BrowserWindow.getAllWindows().find(item=>item!==owner);assert.ok(recovered);recovered.close();assert.equal(recovered.isDestroyed(),false);
 bridge.dispose();owner.destroy();

 console.log('Native Electron: cancelled close and reload preserve edits; discard closes documents; hidden panels cannot block preparation; real launcher panels close before before-quit during updates and hide again after recovery.');app.exit(0);
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
