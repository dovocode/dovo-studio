import { build } from 'esbuild'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const result = await build({
  entryPoints: [
    fileURLToPath(new URL('../packages/protocol/src/browser-viewer.ts', import.meta.url)),
  ],
  bundle: true,
  write: false,
  minify: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
})
const script = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')
const icons = {
  home: '<path d="m3 10 9-7 9 7v10H3Z"/>',
  back: '<path d="m14 6-6 6 6 6"/>',
  forward: '<path d="m10 6 6 6-6 6"/>',
  reload: '<path d="M20 7v5h-5M20 12a8 8 0 1 0-2 5"/>',
  rotate: '<path d="M20 7v5h-5M20 12a8 8 0 1 0-2 5"/>',
  keyboard:
    '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M6 13h.01M10 13h.01M14 13h.01M18 13h.01M7 16h10"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
}
const button = (id, label) =>
  `<button type="button" id="${id}" title="${label}" aria-label="${label}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[id]}</svg></button>`
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; connect-src ws: wss:;"><style>
:root{color-scheme:dark;font:14px -apple-system,BlinkMacSystemFont,system-ui,sans-serif;color:#f2f2f3;background:#000}
*{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;overscroll-behavior:none}body{display:flex;flex-direction:column}button,select,input{font:inherit;color:inherit}button,select{height:32px;min-width:32px;border:0;border-radius:7px;background:transparent;padding:0 7px}button:hover,button[aria-pressed=true],summary:hover{background:#ffffff12}button:disabled{opacity:.35}button:focus-visible,select:focus-visible,input:focus-visible,summary:focus-visible,canvas:focus-visible{outline:2px solid #6baeff;outline-offset:-2px}button svg{width:17px;height:17px;vertical-align:middle}input{min-width:0;background:transparent;border:0;border-radius:7px;padding:5px 8px;font-size:13px;height:32px}#browserBar{display:flex;align-items:center;gap:2px;min-height:42px;padding:4px 6px;border-bottom:1px solid #ffffff14;position:relative;flex-shrink:0}#navigation{display:flex;flex:1;min-width:0;order:4;align-items:center}#address{flex:1}#go{color:#9ab4ff;font-size:12px}#tools{display:contents}#home{order:0}#back{order:1}#forward{order:2}#reload{order:3}#deviceButton{order:5}#keyboard{order:6}#more{order:7;position:relative}#more summary{list-style:none;display:flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:7px;cursor:pointer;font-size:20px;line-height:1}#more summary::-webkit-details-marker{display:none}#more[open] summary{background:#ffffff15}#menu{position:absolute;right:0;top:37px;z-index:20;width:190px;padding:6px;background:#252528;border:1px solid #ffffff22;border-radius:10px;box-shadow:0 10px 30px #0009}#menu label{display:block;padding:6px 8px;color:#a0a0a6;font-size:11px}#menu select,#menu button{display:block;width:100%;text-align:left;font-size:12px}#menu select{padding-left:8px}#viewport{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;background:#111113}#page{touch-action:none;display:block;background:white;flex-shrink:0;outline-offset:-2px}#empty{position:absolute;max-width:270px;padding:20px;text-align:center;pointer-events:none;line-height:1.5;color:#929298;font-size:13px}#status{font-size:12px;padding:8px 12px;color:#929298;max-height:90px;overflow:auto;overflow-wrap:anywhere}#status.error{color:#ff9898}#reconnect{align-self:center;margin:6px;color:#6baeff}#editor{position:fixed;bottom:0;left:0;width:1px;height:1px;opacity:.01;font-size:16px;padding:0;border:0}dialog{max-width:calc(100% - 32px);width:360px;border:1px solid #ffffff22;border-radius:18px;background:#242426;color:#f2f2f3;padding:20px}dialog::backdrop{background:#0008}dialog p{white-space:pre-wrap;overflow-wrap:anywhere;max-height:40vh;overflow:auto}dialog input{width:100%}dialog footer{display:flex;justify-content:flex-end;margin-top:12px}dialog button{color:#6baeff}[hidden]{display:none!important}
body.device #browserBar{justify-content:flex-end}body.device #viewport{background:#09090b}body.expanded #browserBar{display:none}body.expanded #status:not(.error){display:none}
</style></head><body>
<div id="browserBar"><form id="navigation" aria-label="Browser address"><input id="address" aria-label="Host browser URL" type="text" inputmode="url" autocapitalize="off" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="localhost:3000"><button id="go" type="submit">Go</button></form>
<div id="tools" role="toolbar" aria-label="Host browser controls">${button('home', 'Home').replace('<button ', '<button hidden ')}${button('back', 'Back')}${button('forward', 'Forward')}${button('reload', 'Reload')}<select id="deviceButton" aria-label="Hardware controls" hidden><option value="">Hardware</option><option value="VolumeUp">Volume up</option><option value="VolumeDown">Volume down</option><option value="Mute">Mute</option><option value="Lock">Lock screen</option></select>${button('keyboard', 'Keyboard')}<details id="more"><summary aria-label="Browser options" title="Browser options">⋮</summary><div id="menu"><label for="preset">Viewport</label><select id="preset" aria-label="Viewport"><option value="fill">Fit view</option><option value="phone">Phone</option><option value="tablet">Tablet</option><option value="desktop">Desktop</option></select>${button('rotate', 'Rotate viewport')}${button('close', 'Close browser session')}</div></details></div></div>
<div id="viewport"><canvas id="page" tabindex="0" aria-label="Remote browser page. Tap to interact, swipe to scroll. Use Keyboard to type." hidden></canvas><div id="empty">Enter an address to start browsing.</div></div>
<textarea id="editor" aria-label="Type into remote page" autocapitalize="off" autocomplete="off" autocorrect="off" spellcheck="false"></textarea>
<div id="status" role="status">Connecting to host browser…</div><button id="reconnect" type="button" hidden>Reconnect</button>
<dialog id="dialog"><form method="dialog"><p id="dialogText"></p><input id="dialogValue" aria-label="Website prompt response"><footer><button id="cancelDialog" value="cancel">Cancel</button><button value="accept">OK</button></footer></form></dialog>
<script>${script}</script></body></html>`
const dir = new URL('../packages/protocol/src/generated/', import.meta.url)
await mkdir(dir, { recursive: true })
await writeFile(
  new URL('browser-viewer.ts', dir),
  `// Generated by scripts/build-browser-viewer.mjs.\nexport const remoteBrowserHtml = ${JSON.stringify(html)}\n`,
)
