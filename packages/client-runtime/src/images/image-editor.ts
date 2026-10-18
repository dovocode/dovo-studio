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
  if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(source))
    throw new Error('Choose a PNG, JPEG or WebP image to edit.')
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><style>
*{box-sizing:border-box}html,body{margin:0;height:100%;background:#18181b;color:#fafafa;font:14px system-ui}body{display:flex;flex-direction:column}header,footer,.tools,.brush{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:8px}header{justify-content:space-between;border-bottom:1px solid #3f3f46}h1{font-size:16px;margin:0}button,input{font:inherit}button{border:1px solid #52525b;background:#27272a;color:inherit;border-radius:8px;min-height:40px;padding:8px 10px;cursor:pointer}button[aria-pressed=true]{background:#164e63;border-color:#67e8f9}button:disabled{opacity:.4;cursor:default}button:focus-visible,input:focus-visible{outline:2px solid #67e8f9;outline-offset:2px}.brush{padding-top:0}.brush input{width:90px}.swatch{width:32px;min-height:32px;padding:0;border:2px solid #71717a}.swatch[aria-pressed=true]{outline:2px solid white;outline-offset:1px}#stage{flex:1;min-height:80px;display:flex;align-items:center;justify-content:center;overflow:hidden;padding:10px;background:#101012}canvas{touch-action:none;background:repeating-conic-gradient(#303034 0% 25%,#252528 0% 50%) 50%/16px 16px;cursor:crosshair}#hint{margin:0;padding:5px 10px;color:#b4b4bd;font-size:12px}footer{border-top:1px solid #3f3f46;justify-content:flex-end}#attach{background:#0e7490;border-color:#22d3ee}#error{color:#fca5a5;margin:0;padding:0 10px}label{display:flex;align-items:center;gap:6px}@media(max-width:400px){button{padding:7px 8px}.tools{gap:4px}.brush{gap:8px}}
</style></head><body><header><h1>Edit image</h1><button id="cancel">Cancel</button></header><div class="tools" role="toolbar" aria-label="Drawing tools"><button data-tool="pen" aria-pressed="true">Pen</button><button data-tool="highlighter" aria-pressed="false">Highlight</button><button data-tool="arrow" aria-pressed="false">Arrow</button><button data-tool="rectangle" aria-pressed="false">Rectangle</button><button data-tool="crop" aria-pressed="false">Crop</button><button id="undo" disabled>Undo</button><button id="redo" disabled>Redo</button><button id="reset" disabled>Reset</button></div><div class="brush"><label>Color <input type="color" id="color" value="#ef4444" aria-label="Stroke color"></label><label>Size <input id="size" type="range" min="2" max="36" value="6" aria-label="Stroke size"></label></div><p id="hint" role="status">Draw on the image. Changes stay here until you attach it.</p><div id="stage"><canvas aria-label="Image canvas"></canvas></div><p id="error" role="alert"></p><footer><button id="original">Use original</button><button id="attach" disabled>Attach image</button></footer><script id="image-source" type="application/json">${JSON.stringify(source)}</script><script>${imageEditorScript}</script></body></html>`
}
