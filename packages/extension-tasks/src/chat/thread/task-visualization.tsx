import { useEffect, useState } from 'react'
import { useWorkspace } from '@dovo/studio-core'
import { artifactPreviewHtml, responses } from '@dovo/protocol'
import { Button } from '@dovo/studio-ui'
import { FloatingPreview, type PreviewPlacement } from '../../detail/floating-preview'
import { useArtifactPreviewTheme } from '../preview-theme'

export function TaskVisualization({
  taskId,
  path,
  label,
}: {
  taskId: string
  path: string
  label: string
}) {
  const { request, connected, connection } = useWorkspace()
  const previewTheme = useArtifactPreviewTheme()
  const [loaded, setLoaded] = useState<{ key: string; contents: string }>()
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [source, setSource] = useState(false)
  const [placement, setPlacement] = useState<PreviewPlacement>('inline')
  const key = JSON.stringify([taskId, path, connection?.address, connection?.token, reload])
  const content = loaded?.key === key ? loaded.contents : undefined
  useEffect(() => {
    let active = true
    setError('')
    if (!connected || content !== undefined) return
    void request('/api/tasks/visualizations/read', { taskId, path }, responses.projectFile).then(
      (result) => {
        if (active) setLoaded({ key, contents: result.contents })
      },
      (cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause))
      },
    )
    return () => {
      active = false
    }
  }, [request, connected, taskId, path, key, content])
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
          <>
            <Button
              size="sm"
              variant="ghost"
              disabled={!connected}
              onClick={() => setReload((value) => value + 1)}
            >
              Refresh visualization
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSource((value) => !value)}>
              {source ? 'Show preview' : 'View source'}
            </Button>
          </>
        }
      >
        {!connected && content !== undefined && (
          <p role="status" className="px-4 py-2 text-xs text-muted-foreground">
            Computer offline · Showing loaded preview
          </p>
        )}
        {!connected && content === undefined ? (
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
            srcDoc={artifactPreviewHtml(content, previewTheme)}
            className="min-h-0 w-full flex-1 border-0"
          />
        )}
      </FloatingPreview>
    </div>
  )
}
