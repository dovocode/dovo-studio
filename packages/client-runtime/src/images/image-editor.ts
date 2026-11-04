import { imageEditorScript, imageEditorFont } from './image-editor-script.js'
/** The same offline canvas editor runs in a sandboxed desktop frame and a mobile WebView. */
export type ImageEditorResult = { type: 'cancel' | 'original' } | { type: 'edited'; data: string }
export function parseImageEditorResult(value: unknown): ImageEditorResult | null {
  if (
    !value ||
    typeof value !== 'object' ||
    !('channel' in value) ||
    value.channel !== 'dovo-image-editor' ||
    !('type' in value)
  )
    return null
  if (value.type === 'cancel' || value.type === 'original') return { type: value.type }
  if (
    value.type === 'edited' &&
    'data' in value &&
    typeof value.data === 'string' &&
    /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value.data) &&
    value.data.length <= 32 * 1024 * 1024
  )
    return { type: 'edited', data: value.data }
  return null
}
export function imageEditorDocument(source: string, theme: 'dark' | 'light' = 'dark') {
  if (!/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(source))
    throw new Error('Choose a PNG, JPEG, WebP or GIF image to edit.')
  const icons = {
    close: '<path d="m6 6 12 12M6 18 18 6"/>',
    pan: '<path d="M8 13V5a2 2 0 0 1 4 0v7-9a2 2 0 0 1 4 0v9-6a2 2 0 0 1 4 0v9c0 5-3 7-7 7-3 0-5-2-7-5l-3-5a2 2 0 0 1 3-2l2 3Z"/>',
    zoomIn: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6M7 10h6M10 7v6"/>',
    zoomOut: '<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6M7 10h6"/>',
    pen: '<path d="m16 3 5 5-12 12-6 1 1-6Z M14 5l5 5"/>',
    highlighter: '<path d="m9 11 8-8 4 4-8 8-4-4Z M9 11l-3 3v3h3l4-3 M5 17l-3 4h7"/>',
    arrow: '<path d="M7 17 17 7M7 7h10v10"/>',
    rectangle: '<rect x="4" y="4" width="16" height="16" rx="2"/>',
    crop: '<path d="M6 3v12a3 3 0 0 0 3 3h12 M3 6h12a3 3 0 0 1 3 3v12"/>',
    undo: '<path d="M9 14 4 9l5-5 M4 9h10a6 6 0 0 1 0 12"/>',
    redo: '<path d="m15 14 5-5-5-5 M20 9H10a6 6 0 0 0 0 12"/>',
    reset: '<path d="M3 11a9 9 0 1 1 2 7 M3 4v7h7"/>',
  }
  const iconButton = (
    icon: keyof typeof icons,
    label: string,
    shortcut: string,
    attributes: string,
  ) =>
    `<button class="icon-button" aria-label="${label}" title="${label}${shortcut ? ` (${shortcut})` : ''}" ${attributes}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[icon]}</svg></button>`
  return `<!doctype html><html data-theme="${theme === 'light' ? 'light' : 'dark'}"><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><style>
@font-face{font-family:Inter;src:url("${imageEditorFont}") format("woff2");font-weight:100 900;font-display:swap}
*{box-sizing:border-box}
:root{color-scheme:dark;--canvas:#080808;--surface:#181818;--field:#141414;--hover:#222;--edge:#282828;--text:#e6e6e6;--muted:#a3a3a3;--selected:#142432;--focus:#7cc9ff;--action:#e6e6e6;--action-text:#080808;--error:#fca5a5;--checker-a:#272727;--checker-b:#202020}
:root[data-theme=light]{color-scheme:light;--canvas:#fafbfc;--surface:#fff;--field:#f5f5f6;--hover:#e9e9ec;--edge:#dfe2e7;--text:#242933;--muted:#5d6674;--selected:#e8eff9;--focus:#3565a1;--action:#242933;--action-text:#fff;--error:#b42330;--checker-a:#e8e8eb;--checker-b:#f6f6f7}
html,body{margin:0;height:100%;background:var(--surface);color:var(--text);font:14px Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
body{display:flex;flex-direction:column;overflow-x:hidden;overflow-y:auto}
body>header,body>.tools,body>details,body>p,body>footer{flex-shrink:0}
header #close{margin-left:auto}header,footer,.tools,.brush{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:16px 20px}
header{justify-content:space-between;border-bottom:1px solid var(--edge);padding-block:12px}
h1{font-size:16px;font-weight:600;letter-spacing:-.02em;margin:0}
button,input{font:inherit}button{border:1px solid transparent;background:var(--field);color:inherit;border-radius:8px;min-height:36px;padding:8px 12px;cursor:pointer}
button:hover:not(:disabled){background:var(--hover)}button[aria-pressed=true]{background:var(--selected);border-color:var(--focus);color:var(--text)}
button:disabled{opacity:.4;cursor:default}button:focus-visible,input:focus-visible,summary:focus-visible,canvas:focus-visible{outline:2px solid var(--focus);outline-offset:2px}
.tools{gap:4px;padding-block:8px}.icon-button{background:transparent;width:36px;height:36px;min-height:36px;padding:0;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}.icon-button svg{width:18px;height:18px;pointer-events:none}
.tool-divider{width:1px;height:20px;background:var(--edge);margin:0 8px}
body:has([data-tool=crop][aria-pressed=true]) .brush{display:none}
.brush{padding:0;margin-left:auto;gap:16px;color:var(--muted)}.brush input{width:84px;accent-color:var(--focus)}.brush input[type=color]{width:32px;height:28px;border:1px solid var(--edge);border-radius:6px;background:var(--field);padding:3px}
#stage{flex:1 1 80px;min-width:0;min-height:80px;display:flex;align-items:safe center;justify-content:safe center;overflow:auto;padding:10px;background:var(--canvas);border-block:1px solid var(--edge)}
canvas{flex-shrink:0;touch-action:none;background:repeating-conic-gradient(var(--checker-a) 0% 25%,var(--checker-b) 0% 50%) 50%/16px 16px;cursor:crosshair}
#shortcuts{padding:0 20px;font-size:12px;color:var(--muted)}#shortcuts summary{cursor:pointer;min-height:28px;display:flex;align-items:center;gap:6px}#shortcuts summary::before{content:'›';font-size:16px;transform:rotate(0deg)}#shortcuts[open] summary::before{transform:rotate(90deg)}#shortcuts p{margin:4px 0 8px;line-height:1.6}
#hint{margin:0;padding:4px 20px 8px;color:var(--muted);font-size:12px;line-height:1.5}
.viewport-controls{display:flex;align-items:center;gap:4px;margin-right:auto}.viewport-controls output{min-width:44px;text-align:center;font-size:13px;color:var(--text)}.viewport-controls button:not([aria-pressed=true]){background:transparent}footer{justify-content:flex-end;border-top:1px solid var(--edge)}#cancel{background:transparent}#original{background:transparent;border-color:var(--edge)}#attach{background:var(--action);color:var(--action-text);border-color:var(--action)}#attach:hover:not(:disabled){filter:brightness(.94);background:var(--action)}
#error{color:var(--error);margin:0;padding:0 20px}#error:empty{display:none}label{display:flex;align-items:center;gap:8px}
@media(pointer:coarse){button,.icon-button{min-height:44px}.icon-button{width:44px;height:44px}}
@media(max-width:600px){header,footer,.tools{padding:10px 12px}.brush{margin-left:0;width:100%;padding-top:8px}#hint,#shortcuts{padding-inline:12px}button{padding:7px 10px}.tool-divider{margin-inline:4px}}
@media(forced-colors:active){button[aria-pressed=true]{outline:2px solid Highlight}#stage,canvas{border:1px solid CanvasText}}

</style></head><body><header><h1>Edit image</h1>${iconButton('close', 'Close editor', 'Escape', 'id="close"')}</header><div class="tools" role="toolbar" aria-label="Drawing tools">${iconButton('pen', 'Pen', 'P / B', 'data-tool="pen" aria-pressed="true" aria-keyshortcuts="P B"')}${iconButton('highlighter', 'Highlight', 'H', 'data-tool="highlighter" aria-pressed="false" aria-keyshortcuts="H"')}${iconButton('arrow', 'Arrow', 'A', 'data-tool="arrow" aria-pressed="false" aria-keyshortcuts="A"')}${iconButton('rectangle', 'Rectangle', 'R', 'data-tool="rectangle" aria-pressed="false" aria-keyshortcuts="R"')}${iconButton('pan', 'Pan', 'V', 'id="pan" aria-pressed="false" aria-keyshortcuts="V"')}${iconButton('crop', 'Crop', 'C', 'data-tool="crop" aria-pressed="false" aria-keyshortcuts="C"')}<span class="tool-divider" aria-hidden="true"></span>${iconButton('undo', 'Undo', '⌘ / Ctrl Z', 'id="undo" disabled aria-keyshortcuts="Meta+Z Control+Z"')}${iconButton('redo', 'Redo', '⌘ / Ctrl Shift Z · Ctrl Y', 'id="redo" disabled aria-keyshortcuts="Meta+Shift+Z Control+Shift+Z Control+Y"')}${iconButton('reset', 'Reset', '', 'id="reset" disabled')}<div class="brush"><label>Color <input type="color" id="color" value="#ef4444" aria-label="Stroke color"></label><label>Size <input id="size" type="range" min="2" max="36" value="6" aria-label="Stroke size"></label></div></div><details id="shortcuts"><summary>Keyboard shortcuts</summary><p>P / B Pen · H Highlight · A Arrow · R Rectangle · C Crop · V Pan<br>⌘ / Ctrl Z Undo · ⌘ / Ctrl Shift Z or Ctrl Y Redo<br>[ / ] Brush size · Enter Attach (also ⌘ / Ctrl Enter) · Esc Cancel</p></details><p id="hint" role="status">Draw on the image. Changes stay here until you attach it.</p><div id="stage"><canvas tabindex="0" aria-label="Image canvas"></canvas></div><p id="error" role="alert"></p><footer><div class="viewport-controls" role="group" aria-label="Image zoom">${iconButton('zoomOut', 'Zoom out', '', 'id="zoom-out"')}<output id="zoom-level" aria-label="Zoom level">100%</output>${iconButton('zoomIn', 'Zoom in', '', 'id="zoom-in"')}<button id="zoom-fit" aria-pressed="true">Fit</button><button id="zoom-actual" aria-pressed="false">Actual size</button></div><button id="cancel" title="Cancel (Escape)" aria-keyshortcuts="Escape">Cancel</button><button id="original">Use original</button><button id="attach" disabled title="Attach image (Enter)" aria-keyshortcuts="Enter Meta+Enter Control+Enter">Attach image</button></footer><script id="image-source" type="application/json">${JSON.stringify(source)}</script><script>${imageEditorScript}</script></body></html>`
}
