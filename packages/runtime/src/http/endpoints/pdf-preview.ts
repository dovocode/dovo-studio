import { open } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { ServerResponse } from 'node:http'
import { HttpError } from '../../errors.js'

/** PDF.js and its fonts are served through the same authenticated file grant. */
export async function servePDFAsset(response: ServerResponse, url: URL) {
  const module = url.searchParams.get('pdfjs'),
    asset = url.searchParams.get('pdfasset')
  if (module === null && asset === null) return false
  let path: string
  if (module === 'main' || module === 'worker')
    path = fileURLToPath(
      import.meta.resolve(`pdfjs-dist/build/pdf${module === 'worker' ? '.worker' : ''}.mjs`),
    )
  else if (asset && /^(?:cmaps|standard_fonts|wasm)\/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*$/.test(asset))
    path = join(dirname(fileURLToPath(import.meta.resolve('pdfjs-dist/package.json'))), asset)
  else throw new HttpError(400, 'Invalid PDF viewer asset')
  const handle = await open(path, 'r')
  try {
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader(
      'Content-Type',
      module
        ? 'text/javascript'
        : asset?.endsWith('.wasm')
          ? 'application/wasm'
          : 'application/octet-stream',
    )
    response.setHeader('Content-Length', (await handle.stat()).size)
    await pipeline(handle.createReadStream(), response)
  } finally {
    await handle.close()
  }
  return true
}
/** Render one page at a time, bounded to a mobile-friendly canvas size. */
export function pdfPreviewHTML(nonce: string, path: string) {
  // Runtime-generated capability paths contain only URL-safe characters.
  return `<nav aria-label="PDF pages"><button id="previous">Previous</button><span id="page" role="status">Loading PDF…</span><button id="next">Next</button><button id="smaller" aria-label="Zoom out">−</button><button id="larger" aria-label="Zoom in">+</button></nav><p id="error" role="alert"></p><canvas id="pdf" aria-label="PDF page"></canvas><script type="module" nonce="${nonce}">
import {getDocument, GlobalWorkerOptions} from '${path}?pdfjs=main';
GlobalWorkerOptions.workerSrc = '${path}?pdfjs=worker';
const canvas = document.getElementById('pdf'), status = document.getElementById('page'), error = document.getElementById('error');
let documentPDF, page = 1, zoom = 1, rendering = false, pending = false, generation = 0, committed;
const bridgeId = new URLSearchParams(location.hash.slice(1)).get('dovo-pdf');
const bridged = /^[0-9a-f-]{36}$/i.test(bridgeId || '') &&
  (window.parent !== window || typeof window.ReactNativeWebView?.postMessage === 'function');
let accepted = !bridged, restored = !bridged, restoring = false, restoreState = null;
function validState(value) {
  return value && Number.isSafeInteger(value.page) && value.page >= 1 &&
    Number.isFinite(value.zoom) && value.zoom >= .5 && value.zoom <= 3 &&
    Number.isFinite(value.scrollTop) && value.scrollTop >= 0 && value.scrollTop <= 10000000 &&
    Number.isFinite(value.scrollLeft) && value.scrollLeft >= 0 && value.scrollLeft <= 10000000;
}
function send(type, state) {
  if (!bridged) return;
  const message = {channel:'dovo-pdf', id:bridgeId, type, ...(state ? {state} : {})};
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(message));
  else if (window.parent !== window) window.parent.postMessage(message, '*');
}
function report() {
  if (restored && committed) send('state', {page:committed.page, zoom:committed.zoom, scrollTop:scrollY, scrollLeft:scrollX});
}
let acceptRestore;
const restoration = bridged ? new Promise(resolve => {acceptRestore = resolve;}) : Promise.resolve();
addEventListener('message', event => {
  const message = event.data;
  if (!bridged || accepted || (event.source !== window.parent && event.source !== window) ||
      !message || message.channel !== 'dovo-pdf' || message.id !== bridgeId || message.type !== 'restore' ||
      (message.state !== null && !validState(message.state))) return;
  accepted = true;
  restoreState = message.state;
  acceptRestore();
});
addEventListener('scroll', report, {passive:true});
send('ready');
async function render(restore = false) {
  if (!accepted || (!restored && !restore)) return;
  const request = ++generation;
  if (!documentPDF) return;
  if (rendering) {pending = true; return;}
  rendering = true;
  const renderedPage = page, renderedZoom = zoom;
  const width = Math.min(1600, Math.max(240, innerWidth - 24) * renderedZoom);
  let current;
  try {
    current = await documentPDF.getPage(renderedPage);
    if (request !== generation) return;
    const natural = current.getViewport({scale: 1});
    const scale = Math.min(width / natural.width, Math.sqrt(4000000 / (natural.width * natural.height)));
    const viewport = current.getViewport({scale});
    const staged = document.createElement('canvas');
    staged.width = viewport.width; staged.height = viewport.height;
    await current.render({canvasContext: staged.getContext('2d'), viewport}).promise;
    if (request !== generation) return;
    canvas.width = staged.width; canvas.height = staged.height;
    canvas.getContext('2d').drawImage(staged, 0, 0);
    canvas.style.width = viewport.width + 'px'; canvas.style.maxWidth = renderedZoom <= 1 ? '100%' : 'none'; canvas.style.height = 'auto';
    status.textContent = 'Page ' + renderedPage + ' of ' + documentPDF.numPages;
    document.getElementById('previous').disabled = renderedPage === 1;
    document.getElementById('next').disabled = renderedPage === documentPDF.numPages;
    committed = {page: renderedPage, zoom: renderedZoom};
    if (restoreState) {scrollTo(restoreState.scrollLeft, restoreState.scrollTop); restoreState = null;}
    if (restoring) {restored = true; restoring = false;}
    report();
    error.textContent = '';
  } catch (cause) {if (request === generation) {if (restoring) {restored = true; restoring = false;} if (committed) {page = committed.page; zoom = committed.zoom;} error.textContent = 'Could not preview PDF: ' + cause.message + '. Download the original to open it.';}}
  finally {try {current?.cleanup();} finally {rendering = false; if (pending) {pending = false; void render();}}}
}
document.getElementById('previous').onclick = () => {if (restored && page > 1) {page--; void render();}};
document.getElementById('next').onclick = () => {if (restored && documentPDF && page < documentPDF.numPages) {page++; void render();}};
document.getElementById('smaller').onclick = () => {if (restored) {zoom = Math.max(.5, zoom - .25); void render();}};
document.getElementById('larger').onclick = () => {if (restored) {zoom = Math.min(3, zoom + .25); void render();}};
let resizeTimer; addEventListener('resize', () => {clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 150);});
try {documentPDF = await getDocument({url: '${path}?content=1', isEvalSupported: false, disableAutoFetch: true, disableStream: true, cMapUrl: '${path}?pdfasset=cmaps/', cMapPacked: true, standardFontDataUrl: '${path}?pdfasset=standard_fonts/', wasmUrl: '${path}?pdfasset=wasm/'}).promise; await restoration; if (restoreState) {page = Math.min(restoreState.page, documentPDF.numPages); zoom = restoreState.zoom;} restoring = bridged; await render(true);}
catch (cause) {status.textContent = 'PDF unavailable'; error.textContent = 'Could not preview PDF: ' + cause.message + '. Download the original to open it.';}
</script>`
}
