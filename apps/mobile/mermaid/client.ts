import mermaid from 'mermaid'
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
async function renderDiagram(chart: string, colors: DiagramColors) {
  const attempt = ++generation
  try {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      themeVariables: {
        primaryColor: colors.surface,
        primaryTextColor: colors.text,
        primaryBorderColor: colors.border,
        lineColor: colors.muted,
        textColor: colors.text,
        secondaryColor: colors.selection,
        tertiaryColor: colors.elevated,
        edgeLabelBackground: colors.background,
      },
      suppressErrorRendering: true,
      maxTextSize: 50000,
      maxEdges: 500,
    })
    document.documentElement.style.color = colors.text
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
