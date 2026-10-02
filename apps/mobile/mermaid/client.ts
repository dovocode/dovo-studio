import mermaid from 'mermaid'
const diagram = document.getElementById('diagram')!
function report(message: unknown) {
  const native = Reflect.get(window, 'ReactNativeWebView')
  if (native && typeof native.postMessage === 'function')
    native.postMessage(JSON.stringify(message))
}
mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  theme: 'dark',
  suppressErrorRendering: true,
  maxTextSize: 50000,
  maxEdges: 500,
})
let generation = 0
async function renderDiagram(chart: string) {
  const attempt = ++generation
  try {
    const { svg } = await mermaid.render(`diagram-${attempt}`, chart)
    if (attempt !== generation) return
    diagram.innerHTML = svg
    report({ height: Math.ceil(diagram.getBoundingClientRect().height) })
  } catch {
    if (attempt === generation) report({ error: 'Could not render diagram. Mermaid source:' })
  }
}
Reflect.set(window, 'renderDiagram', renderDiagram)
new ResizeObserver(() =>
  report({ height: Math.ceil(diagram.getBoundingClientRect().height) }),
).observe(diagram)
