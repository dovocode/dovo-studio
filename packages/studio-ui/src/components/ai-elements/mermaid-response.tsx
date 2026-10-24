import { useMemo, type ComponentProps } from 'react'
import { Streamdown, type DiagramPlugin } from 'streamdown'
import { render } from 'pele'

// Keep Streamdown's diagram controls while using Pele for Mermaid syntax.
const mermaid: DiagramPlugin = {
  name: 'mermaid',
  language: 'mermaid',
  type: 'diagram',
  getMermaid: () => ({
    initialize: () => {},
    async render(id, source) {
      const result = render(source, {
        idPrefix: id,
        limit: 50000,
        maxEdges: 500,
        links: false,
        images: false,
      })
      if (typeof document === 'undefined') return result
      // SVG downloads need fallback colors without Studio's stylesheet. Keep token
      // references too, so diagrams already on screen still follow theme changes.
      const svg = new DOMParser().parseFromString(result.svg, 'image/svg+xml').documentElement
      const theme = getComputedStyle(document.documentElement)
      for (const [name, token] of Object.entries({
        bg: 'background',
        fg: 'foreground',
        muted: 'muted-foreground',
        line: 'muted-foreground',
        surface: 'card',
        'surface-alt': 'muted',
        border: 'border',
        accent: 'primary',
      })) {
        const color = theme.getPropertyValue(`--${token}`).trim()
        if (color) svg.style.setProperty(`--pele-${name}`, `var(--${token}, ${color})`)
      }
      return { svg: new XMLSerializer().serializeToString(svg) }
    },
  }),
}
function DiagramError({ chart }: { chart: string }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="mb-2 text-xs text-muted-foreground">
        Could not render diagram. Mermaid source:
      </p>
      <pre className="overflow-auto text-xs">
        <code>{chart}</code>
      </pre>
    </div>
  )
}
export default function MermaidResponse(props: ComponentProps<typeof Streamdown>) {
  const plugins = useMemo(() => ({ ...props.plugins, mermaid }), [props.plugins])
  const options = useMemo(() => ({ errorComponent: DiagramError }), [])
  return <Streamdown {...props} plugins={plugins} mermaid={options} />
}
