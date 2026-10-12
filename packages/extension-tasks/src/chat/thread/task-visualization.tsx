import { useEffect, useState } from 'react'
import { useWorkspace } from '@dovo/studio-core'
import { artifactPreviewHtml, responses } from '@dovo/protocol'
import { Button } from '@dovo/studio-ui'
import { FloatingPreview, type PreviewPlacement } from '../../detail/floating-preview'

export function TaskVisualization({
  taskId,
  path,
  label,
}: {
  taskId: string
  path: string
  label: string
}) {
  const { request, connected } = useWorkspace()
  const [content, setContent] = useState<string>()
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [source, setSource] = useState(false)
  const [placement, setPlacement] = useState<PreviewPlacement>('inline')
  useEffect(() => {
    let active = true
    setContent(undefined)
    setError('')
    if (!connected) return
    void request('/api/tasks/visualizations/read', { taskId, path }, responses.projectFile).then(
      (result) => {
        if (active) setContent(result.contents)
      },
      (cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause))
      },
    )
    return () => {
      active = false
    }
  }, [request, connected, taskId, path, reload])
  return (
    <div
      className="my-3 min-w-0 overflow-visible rounded-xl border bg-card"
      data-visualization={path}
    >
      <FloatingPreview
        title={label}
        placement={placement}
        onPlacementChange={setPlacement}
        onClose={placement === 'inline' ? undefined : () => setPlacement('inline')}
        actions={
          <Button size="sm" variant="ghost" onClick={() => setSource((value) => !value)}>
            {source ? 'Show preview' : 'View source'}
          </Button>
        }
      >
        {!connected ? (
          <p className="p-4 text-sm">Reconnect to the computer to load this visualization.</p>
        ) : error ? (
          <div role="alert" className="p-4 text-sm">
            <p>{error}</p>
            <Button onClick={() => setReload((value) => value + 1)}>Retry preview</Button>
          </div>
        ) : content === undefined ? (
          <p role="status" className="p-4 text-sm">
            Loading visualization…
          </p>
        ) : source ? (
          <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-4 text-xs">
            {content}
          </pre>
        ) : (
          <iframe
            title={label}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            srcDoc={artifactPreviewHtml(content)}
            className="min-h-0 w-full flex-1 border-0"
          />
        )}
      </FloatingPreview>
    </div>
  )
}
