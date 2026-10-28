import { app, BrowserWindow } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type BrowserDeviceChoice = { id: string; label: string; remember?: boolean }
export type BrowserDeviceAnswer = { id: string; remember: boolean }
export type BrowserDeviceChooser = {
  update(devices: BrowserDeviceChoice[]): void
  close(): void
  answer: Promise<BrowserDeviceAnswer | undefined>
}

/** Trusted, isolated native chooser. Device names are always text, never HTML. */
export function openBrowserDeviceChooser(options: {
  parent?: BrowserWindow
  title: string
  message: string
  devices: BrowserDeviceChoice[]
  input?: boolean
}): BrowserDeviceChooser {
  const directory = join(app.getPath('userData'), 'browser-runtime')
  mkdirSync(directory, { recursive: true })
  const preload = join(directory, 'device-chooser.cjs')
  writeFileSync(
    preload,
    `const {contextBridge,ipcRenderer}=require('electron')
contextBridge.exposeInMainWorld('chooser',{
  read:()=>ipcRenderer.invoke('device-chooser:read'),
  answer:value=>ipcRenderer.send('device-chooser:answer',value),
  watch:callback=>ipcRenderer.on('device-chooser:update',(_event,state)=>callback(state)),
})`,
  )
  const window = new BrowserWindow({
    title: options.title,
    parent: options.parent,
    modal: !!options.parent,
    width: 480,
    height: 420,
    minWidth: 360,
    minHeight: 320,
    show: false,
    autoHideMenuBar: true,
    webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  let devices = options.devices
  let revision = 0
  const state = () => ({
    title: options.title,
    message: options.message,
    input: options.input,
    devices,
    revision,
  })
  let settle = (_value: BrowserDeviceAnswer | undefined) => {}
  const answer = new Promise<BrowserDeviceAnswer | undefined>((resolve) => {
    settle = resolve
  })
  const finish = (value?: BrowserDeviceAnswer) => {
    settle(value)
    if (!window.isDestroyed()) window.close()
  }
  window.webContents.ipc.handle('device-chooser:read', (event) =>
    event.senderFrame === window.webContents.mainFrame ? state() : undefined,
  )
  window.webContents.ipc.on('device-chooser:answer', (event, raw: unknown) => {
    if (event.senderFrame !== window.webContents.mainFrame) return
    if (!raw || typeof raw !== 'object' || !('id' in raw) || typeof raw.id !== 'string')
      return finish()
    const choice = devices.find((device) => device.id === raw.id)
    if (options.input ? !/^[\x20-\x7e]{1,16}$/.test(raw.id) : !choice) return finish()
    finish({
      id: raw.id,
      remember: !!choice?.remember && 'remember' in raw && raw.remember === true,
    })
  })
  const timeout = setTimeout(() => finish(), 120_000)
  window.once('closed', () => {
    clearTimeout(timeout)
    settle(undefined)
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  const html = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'">
<style>
:root{color-scheme:light dark;font:14px system-ui}body{margin:20px;display:flex;flex-direction:column;gap:14px;height:calc(100vh - 40px);box-sizing:border-box;overflow:auto}h1{font-size:17px;margin:0}p{margin:0;overflow-wrap:anywhere;max-height:90px;overflow:auto;flex-shrink:0}select{width:100%;flex:1;min-height:90px;padding:6px;border-radius:8px}option{padding:8px}footer{display:flex;justify-content:flex-end;gap:10px}button,input{font:inherit;padding:8px 14px}button{border-radius:8px}label{display:flex;gap:8px;align-items:center}#empty{font-size:13px;opacity:.7}[hidden]{display:none!important}
</style></head><body><h1></h1><p></p><select aria-label="Device" size="7"></select>
<div id="empty">Searching for devices…</div><input hidden aria-label="Pairing PIN" maxlength="16" autocomplete="off">
<label id="remember"><input type="checkbox">Remember this device for this website</label>
<footer><button id="cancel">Cancel</button><button id="connect" disabled>Connect</button></footer>
<script>
const select=document.querySelector('select'),pin=document.querySelector('input[aria-label]'),remember=document.querySelector('#remember'),check=remember.querySelector('input'),connect=document.querySelector('#connect');
let state;
function changed(){const device=state.devices.find(device=>device.id===select.value);remember.hidden=!!state.input||!device?.remember;connect.disabled=state.input?!pin.value:!device}
function render(next){if(state&&next.revision<state.revision)return;state=next;document.title=next.title;document.querySelector('h1').textContent=next.title;document.querySelector('p').textContent=next.message;const selected=select.value;select.replaceChildren(...next.devices.map(device=>{const option=document.createElement('option');option.value=device.id;option.textContent=device.label;return option}));if(next.devices.some(device=>device.id===selected))select.value=selected;select.hidden=!!next.input;pin.hidden=!next.input;document.querySelector('#empty').hidden=!!next.input||next.devices.length>0;connect.textContent=next.input?'Pair':'Connect';changed()}
window.chooser.watch(render);window.chooser.read().then(render);select.onchange=changed;pin.oninput=changed;
function answer(){if(!connect.disabled)window.chooser.answer({id:state.input?pin.value:select.value,remember:check.checked})}
connect.onclick=answer;select.ondblclick=answer;document.querySelector('#cancel').onclick=()=>window.chooser.answer(null);
document.addEventListener('keydown',event=>{if(event.key==='Escape')window.chooser.answer(null);if(event.key==='Enter')answer()});
</script></body></html>`
  void window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`).then(
    () => {
      if (!window.isDestroyed()) window.show()
    },
    (error: unknown) => {
      console.error('Could not load the device chooser.', error)
      finish()
    },
  )
  return {
    answer,
    update(next) {
      revision++
      devices = next
      if (!window.isDestroyed()) window.webContents.send('device-chooser:update', state())
    },
    close: () => finish(),
  }
}
