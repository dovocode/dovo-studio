import { useMemo, type ComponentProps } from 'react'
import { useResolvedTheme } from '@dovo/studio-core'
import { Streamdown } from 'streamdown'
import { mermaid } from '@streamdown/mermaid'
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
  const theme = useResolvedTheme()
  const plugins = useMemo(() => ({ ...props.plugins, mermaid }), [props.plugins])
  const options = useMemo(
    () => ({
      config: {
        theme: theme === 'dark' ? ('dark' as const) : ('default' as const),
        securityLevel: 'strict' as const,
      },
      errorComponent: DiagramError,
    }),
    [theme],
  )
  return <Streamdown {...props} plugins={plugins} mermaid={options} />
}
