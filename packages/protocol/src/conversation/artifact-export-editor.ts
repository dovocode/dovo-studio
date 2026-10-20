import { Schema } from 'effect'
import { ARTIFACT_MAX_BYTES } from './artifacts.js'
import { maxValue, mutableStruct } from '../shared/schema.js'

export type ArtifactExportEdit = { action: 'apply'; content: string } | { action: 'cancel' }
export const artifactExportEditMessageSchema = mutableStruct({
  nonce: Schema.String,
  action: Schema.Literals(['apply', 'cancel']),
  content: Schema.optional(maxValue(Schema.String, ARTIFACT_MAX_BYTES)),
})

// This function is also serialized into the native WebView. Keep it self-contained.
export function initializeArtifactExportEditor(
  root: Document,
  content: string,
  onAction: (edit: ArtifactExportEdit) => void,
) {
  const frame = root.querySelector<HTMLIFrameElement>('#canvas')
  const text = root.querySelector<HTMLButtonElement>('#text')
  const pick = root.querySelector<HTMLButtonElement>('#pick')
  const remove = root.querySelector<HTMLButtonElement>('#remove')
  const exclude = root.querySelector<HTMLButtonElement>('#exclude')
  const parent = root.querySelector<HTMLButtonElement>('#parent')
  const undo = root.querySelector<HTMLButtonElement>('#undo')
  const apply = root.querySelector<HTMLButtonElement>('#apply')
  const cancel = root.querySelector<HTMLButtonElement>('#cancel')
  const status = root.querySelector<HTMLElement>('#status')
  if (
    !frame ||
    !text ||
    !pick ||
    !remove ||
    !exclude ||
    !parent ||
    !undo ||
    !apply ||
    !cancel ||
    !status
  )
    throw new Error('Export editor controls are missing')
  apply.disabled = true
  cancel.onclick = () => onAction({ action: 'cancel' })
  frame.onload = () => {
    const doc = frame.contentDocument
    const view = doc?.defaultView
    if (!doc?.body || !view) {
      status.textContent = 'Editor unavailable. Close and retry.'
      return
    }
    let selected: Element | undefined
    let selecting = false
    const history: Array<() => void> = []
    const editorStyle = doc.createElement('style')
    editorStyle.setAttribute('data-dovo-export-editor-style', '')
    editorStyle.textContent =
      '[data-dovo-export-selected]{outline:2px solid #1976d2!important;outline-offset:2px}.no-print,[data-no-print]{opacity:.35!important}'
    doc.head.append(editorStyle)
    const excluded = (node: Element) => node.matches('.no-print,[data-no-print]')
    const select = (node?: Element) => {
      selected?.removeAttribute('data-dovo-export-selected')
      selected = node
      selected?.setAttribute('data-dovo-export-selected', '')
      remove.disabled = exclude.disabled = !selected
      parent.disabled = !selected?.parentElement || selected.parentElement === doc.body
      const label = selected && excluded(selected) ? 'Include in export' : 'Exclude from export'
      exclude.setAttribute('aria-label', label)
      exclude.title = label
      exclude.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>${selected && excluded(selected) ? '' : '<path d="m3 3 18 18"/>'}</svg>`
      undo.disabled = history.length === 0
      status.textContent = selected
        ? `${selected.localName}${excluded(selected) ? ' · Excluded from PDF and MHTML' : ''}`
        : selecting
          ? 'Select an element. Use Select parent to choose its section.'
          : 'Edit text directly. Use Select elements to remove or exclude sections.'
    }
    const mode = (value: boolean) => {
      selecting = value
      doc.body.contentEditable = String(!value)
      text.setAttribute('aria-pressed', String(!value))
      pick.setAttribute('aria-pressed', String(value))
      select()
    }
    const remember = (restore: () => void) => {
      history.push(restore)
      if (history.length > 20) history.shift()
    }
    text.onclick = () => mode(false)
    pick.onclick = () => mode(true)
    doc.addEventListener('click', (event) => {
      // Links and form buttons stay inert while preparing an export.
      if (selecting || (event.target instanceof view.Element && event.target.closest('a,button')))
        event.preventDefault()
      if (!selecting || !(event.target instanceof view.Element)) return
      const node = event.target
      if (['html', 'head', 'body', 'style', 'script', 'meta', 'link'].includes(node.localName))
        return
      select(node)
    })
    doc.addEventListener('submit', (event) => event.preventDefault())
    doc.addEventListener('drop', (event) => event.preventDefault())
    parent.onclick = () => {
      const node = selected?.parentElement
      if (node && node !== doc.body && node !== doc.documentElement) select(node)
    }
    remove.onclick = () => {
      const node = selected
      const container = node?.parentNode
      if (!node || !container) return
      const next = node.nextSibling
      remember(() => container.insertBefore(node, next?.parentNode === container ? next : null))
      node.remove()
      select()
    }
    exclude.onclick = () => {
      const node = selected
      if (!node) return
      const previousClass = node.getAttribute('class')
      const previousMarker = node.getAttribute('data-no-print')
      remember(() => {
        if (previousClass === null) node.removeAttribute('class')
        else node.setAttribute('class', previousClass)
        if (previousMarker === null) node.removeAttribute('data-no-print')
        else node.setAttribute('data-no-print', previousMarker)
      })
      if (excluded(node)) {
        node.classList.remove('no-print')
        node.removeAttribute('data-no-print')
      } else node.setAttribute('data-no-print', '')
      select(node)
    }
    undo.onclick = () => {
      history.pop()?.()
      select()
    }
    apply.onclick = () => {
      const clone = doc.documentElement.cloneNode(true)
      if (!(clone instanceof view.Element)) return
      clone.querySelectorAll('[data-dovo-export-editor-style]').forEach((node) => node.remove())
      clone
        .querySelectorAll('[data-dovo-export-selected]')
        .forEach((node) => node.removeAttribute('data-dovo-export-selected'))
      clone.querySelector('body')?.removeAttribute('contenteditable')
      onAction({ action: 'apply', content: '<!doctype html>' + clone.outerHTML })
    }
    mode(false)
    apply.disabled = false
  }
  // Unlike the interactive preview, this guest has no scripts. The owning editor may access
  // its DOM, but untrusted content cannot call the native bridge or the desktop host.
  const policy =
    "default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'"
  frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy}">${content}`
}

const editorButton = (id: string, label: string, paths: string, disabled = false) =>
  `<button id="${id}" type="button" aria-label="${label}" title="${label}"${disabled ? ' disabled' : ''}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg></button>`

export const artifactExportEditorDocument = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src about:; base-uri 'none'; form-action 'none'"><style>
*{box-sizing:border-box}html,body{margin:0;height:100%;font:14px system-ui;color:#151515;background:#fff}body{display:flex;flex-direction:column}header{padding:10px 12px;border-bottom:1px solid #ddd;display:flex;flex-direction:column;gap:6px}.heading{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}p{margin:0;color:#666;font-size:12px}.row{display:flex;gap:3px;align-items:center}.divider{height:20px;width:1px;background:#ddd;margin:0 4px}button{display:inline-flex;align-items:center;justify-content:center;flex:none;width:36px;height:36px;padding:8px;border:0;border-radius:8px;background:transparent;font:inherit;color:#555;cursor:pointer}button svg{width:18px;height:18px}button:hover:enabled{background:#f0f0f0;color:#151515}button[aria-pressed=true]{background:#e8f1fc;color:#1976d2}button:disabled{opacity:.3;cursor:default}button:focus-visible{outline:2px solid #1976d2;outline-offset:2px}#remove:hover:enabled{background:#fff0f0;color:#b91c1c}#apply{background:#151515;color:white}#apply:hover:enabled{background:#333;color:white}#status{flex:1;min-width:0}#canvas{flex:1;min-height:0;width:100%;border:0}@media(max-width:480px){button{width:44px;height:44px}.row{gap:1px}.divider{margin:0 2px}.heading p{width:100%}}
</style></head><body><header><div class="heading"><strong>Export copy</strong><p>Only PDF / MHTML exports change. Saved source stays unchanged.</p></div><div class="row">
${editorButton('text', 'Edit text', '<path d="m16 3 5 5M4 20l4-1L21 6a2 2 0 0 0-4-4L4 15l-1 6Z"/>')}
${editorButton('pick', 'Select elements', '<path d="m4 3 7 18 2-8 8-2L4 3Z"/>')}
<span class="divider" aria-hidden="true"></span>
${editorButton('parent', 'Select parent', '<path d="m7 10 5-5 5 5M12 5v14M5 19h14"/>', true)}
${editorButton('remove', 'Delete element', '<path d="M3 6h18M9 6V4h6v2M5 6l1 14h12l1-14M10 10v6M14 10v6"/>', true)}
${editorButton('exclude', 'Exclude from export', '<path d="m3 3 18 18M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>', true)}
<span class="divider" aria-hidden="true"></span>
${editorButton('undo', 'Undo removal / exclusion', '<path d="m9 5-5 5 5 5M4 10h10a6 6 0 0 1 0 12"/>', true)}
</div><div class="row"><p id="status" role="status">Preparing editor…</p>
${editorButton('cancel', 'Discard edits', '<path d="m6 6 12 12M6 18 18 6"/>')}
${editorButton('apply', 'Use edited copy', '<path d="m5 12 4 4L19 6"/>', true)}
</div></header><iframe id="canvas" title="Editable export content" sandbox="allow-same-origin" referrerpolicy="no-referrer"></iframe></body></html>`

export function artifactExportEditorHtml(content: string, nonce: string) {
  const argument = JSON.stringify(content).replace(/</g, '\\u003c')
  const key = JSON.stringify(nonce).replace(/</g, '\\u003c')
  const script = `(${initializeArtifactExportEditor.toString()})(document,${argument},edit=>window.ReactNativeWebView.postMessage(JSON.stringify({...edit,nonce:${key}})))`
  return artifactExportEditorDocument.replace('</body>', `<script>${script}</script></body>`)
}
