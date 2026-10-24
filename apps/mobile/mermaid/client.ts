import { render } from 'pele'
const diagram = document.getElementById('diagram')!
function report(message: unknown) {
  const native = Reflect.get(window, 'ReactNativeWebView')
  if (native && typeof native.postMessage === 'function')
    native.postMessage(JSON.stringify(message))
}
type DiagramColors = {
  text: string
  surface: string
  border: string
  muted: string
  background: string
  selection: string
  elevated: string
}
let generation = 0
function renderDiagram(chart: string, colors: DiagramColors) {
  const attempt = ++generation
  try {
    for (const [name, value] of Object.entries({
      bg: colors.background,
      fg: colors.text,
      muted: colors.muted,
      line: colors.muted,
      surface: colors.surface,
      'surface-alt': colors.elevated,
      border: colors.border,
      accent: colors.selection,
    }))
      diagram.style.setProperty(`--pele-${name}`, value)
    document.documentElement.style.color = colors.text
    const { svg } = render(chart, {
      idPrefix: `diagram-${attempt}`,
      limit: 50000,
      maxEdges: 500,
      links: false,
      images: false,
    })
    diagram.innerHTML = svg
    report({ height: Math.ceil(diagram.getBoundingClientRect().height) })
  } catch {
    report({ error: 'Could not render diagram. Mermaid source:' })
  }
}
Reflect.set(window, 'renderDiagram', renderDiagram)
new ResizeObserver(() =>
  report({ height: Math.ceil(diagram.getBoundingClientRect().height) }),
).observe(diagram)
