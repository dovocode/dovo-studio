import { highlightFilteredBrowserJson } from '@dovo/studio-core/browser-json-format'
import { createBrowserJsonFilter } from './browser-json-filter'

/** Runs in an isolated world; only escaped syntax markup enters the document. */
export function installJsonViewer({
  source,
  formatted,
  html,
}: {
  source: string
  formatted: string
  html: string
}) {
  if ((document.querySelector('pre')?.textContent ?? document.body?.textContent) !== source) return
  const filterJson = createBrowserJsonFilter(source)
  document.documentElement.dataset.dovoJson = ''
  const header = document.createElement('header')
  const title = document.createElement('strong')
  title.textContent = 'JSON'
  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.textContent = 'Raw'
  toggle.setAttribute('aria-label', 'Show raw JSON')
  const copy = document.createElement('button')
  copy.type = 'button'
  copy.textContent = 'Copy'
  copy.setAttribute('aria-label', 'Copy JSON')
  const form = document.createElement('form')
  const input = document.createElement('input')
  input.type = 'search'
  input.placeholder = 'JSONPath, e.g. $.data.items[*]'
  input.setAttribute('aria-label', 'JSONPath filter')
  input.setAttribute('aria-describedby', 'dovo-json-filter-status')
  input.autocomplete = 'off'
  input.spellcheck = false
  const clear = document.createElement('button')
  clear.type = 'button'
  clear.textContent = 'Clear'
  clear.disabled = true
  clear.setAttribute('aria-label', 'Clear JSONPath filter')
  const status = document.createElement('span')
  status.id = 'dovo-json-filter-status'
  status.setAttribute('role', 'status')
  status.textContent = 'Showing full response'
  const code = document.createElement('code')
  code.innerHTML = html
  const pre = document.createElement('pre')
  pre.append(code)
  let raw = false
  let selection = { source, formatted }
  const render = () => {
    if (raw) code.textContent = selection.source
    else
      code.innerHTML =
        selection.source === source ? html : highlightFilteredBrowserJson(selection.formatted)
    toggle.textContent = raw ? 'Formatted' : 'Raw'
    toggle.setAttribute('aria-label', raw ? 'Show formatted JSON' : 'Show raw JSON')
    copy.textContent = 'Copy'
  }
  let pending: ReturnType<typeof setTimeout> | undefined
  const apply = () => {
    clearTimeout(pending)
    clear.disabled = !input.value
    try {
      const result = filterJson(input.value)
      selection = result
      input.removeAttribute('aria-invalid')
      status.removeAttribute('data-error')
      status.textContent =
        !input.value.trim() || input.value.trim() === '$'
          ? 'Showing full response'
          : result.count === 0
            ? 'No matches'
            : `${result.count} match${result.count === 1 ? '' : 'es'}`
      render()
    } catch (error) {
      input.setAttribute('aria-invalid', 'true')
      status.dataset.error = ''
      status.textContent = `Invalid JSONPath: ${error instanceof Error ? error.message : 'Check the expression'}. Showing the previous result.`
    }
  }
  input.oninput = () => {
    clear.disabled = !input.value
    clearTimeout(pending)
    pending = setTimeout(apply, 180)
  }
  input.onkeydown = (event) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    input.value = ''
    apply()
  }
  form.onsubmit = (event) => {
    event.preventDefault()
    apply()
  }
  clear.onclick = () => {
    input.value = ''
    apply()
    input.focus()
  }
  toggle.onclick = () => {
    raw = !raw
    render()
  }
  copy.onclick = () => {
    void navigator.clipboard.writeText(raw ? selection.source : selection.formatted).then(
      () => {
        copy.textContent = 'Copied'
      },
      () => {
        copy.textContent = 'Could not copy'
      },
    )
  }
  form.append(input, clear)
  header.append(title, form, toggle, copy, status)
  document.body.replaceChildren(header, pre)
}
