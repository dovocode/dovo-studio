import { imageEditorScript } from './image-editor-script.js'
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
export function imageEditorDocument(source: string) {
  if (!/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(source))
    throw new Error('Choose a PNG, JPEG, WebP or GIF image to edit.')
  const icons = {
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
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><style>
*{box-sizing:border-box}html,body{margin:0;height:100%;background:#18181b;color:#fafafa;font:14px system-ui}body{display:flex;flex-direction:column;overflow-x:hidden;overflow-y:auto}body>header,body>.tools,body>.brush,body>details,body>p,body>footer{flex-shrink:0}header,footer,.tools,.brush{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:8px}header{justify-content:space-between;border-bottom:1px solid #3f3f46}h1{font-size:16px;margin:0}button,input{font:inherit}button{border:1px solid #52525b;background:#27272a;color:inherit;border-radius:8px;min-height:40px;padding:8px 10px;cursor:pointer}button[aria-pressed=true]{background:#164e63;border-color:#67e8f9}button:disabled{opacity:.4;cursor:default}button:focus-visible,input:focus-visible{outline:2px solid #67e8f9;outline-offset:2px}.tools{gap:4px}.icon-button{width:44px;height:44px;min-height:44px;padding:0;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0}.icon-button svg{pointer-events:none}.tool-divider{width:1px;height:24px;background:#52525b;margin:0 4px}.brush{padding-top:0}.brush input{width:90px}.swatch{width:32px;min-height:32px;padding:0;border:2px solid #71717a}.swatch[aria-pressed=true]{outline:2px solid white;outline-offset:1px}#stage{flex:1 0 80px;min-width:0;min-height:80px;display:flex;align-items:center;justify-content:center;overflow:hidden;padding:10px;background:#101012}canvas{touch-action:none;background:repeating-conic-gradient(#303034 0% 25%,#252528 0% 50%) 50%/16px 16px;cursor:crosshair}#shortcuts{padding:0 10px;font-size:12px;color:#b4b4bd}#shortcuts summary{cursor:pointer;min-height:28px;display:flex;align-items:center}#shortcuts p{margin:4px 0 8px;line-height:1.6}#hint{margin:0;padding:5px 10px;color:#b4b4bd;font-size:12px}footer{border-top:1px solid #3f3f46;justify-content:flex-end}#attach{background:#0e7490;border-color:#22d3ee}#error{color:#fca5a5;margin:0;padding:0 10px}label{display:flex;align-items:center;gap:6px}@media(max-width:400px){button{padding:7px 8px}.tools{gap:4px}.brush{gap:8px}}
</style></head><body><header><h1>Edit image</h1><button id="cancel" title="Cancel (Escape)" aria-keyshortcuts="Escape">Cancel</button></header><div class="tools" role="toolbar" aria-label="Drawing tools">${iconButton('pen', 'Pen', 'P / B', 'data-tool="pen" aria-pressed="true" aria-keyshortcuts="P B"')}${iconButton('highlighter', 'Highlight', 'H', 'data-tool="highlighter" aria-pressed="false" aria-keyshortcuts="H"')}${iconButton('arrow', 'Arrow', 'A', 'data-tool="arrow" aria-pressed="false" aria-keyshortcuts="A"')}${iconButton('rectangle', 'Rectangle', 'R', 'data-tool="rectangle" aria-pressed="false" aria-keyshortcuts="R"')}${iconButton('crop', 'Crop', 'C', 'data-tool="crop" aria-pressed="false" aria-keyshortcuts="C"')}<span class="tool-divider" aria-hidden="true"></span>${iconButton('undo', 'Undo', '⌘ / Ctrl Z', 'id="undo" disabled aria-keyshortcuts="Meta+Z Control+Z"')}${iconButton('redo', 'Redo', '⌘ / Ctrl Shift Z · Ctrl Y', 'id="redo" disabled aria-keyshortcuts="Meta+Shift+Z Control+Shift+Z Control+Y"')}${iconButton('reset', 'Reset', '', 'id="reset" disabled')}</div><div class="brush"><label>Color <input type="color" id="color" value="#ef4444" aria-label="Stroke color"></label><label>Size <input id="size" type="range" min="2" max="36" value="6" aria-label="Stroke size"></label></div><details id="shortcuts"><summary>Keyboard shortcuts</summary><p>P / B Pen · H Highlight · A Arrow · R Rectangle · C Crop<br>⌘ / Ctrl Z Undo · ⌘ / Ctrl Shift Z or Ctrl Y Redo<br>[ / ] Brush size · Enter Attach (also ⌘ / Ctrl Enter) · Esc Cancel</p></details><p id="hint" role="status">Draw on the image. Changes stay here until you attach it.</p><div id="stage"><canvas tabindex="0" aria-label="Image canvas"></canvas></div><p id="error" role="alert"></p><footer><button id="original">Use original</button><button id="attach" disabled title="Attach image (Enter)" aria-keyshortcuts="Enter Meta+Enter Control+Enter">Attach image</button></footer><script id="image-source" type="application/json">${JSON.stringify(source)}</script><script>${imageEditorScript}</script></body></html>`
}
