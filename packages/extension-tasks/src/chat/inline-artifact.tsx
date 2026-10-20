import { useEffect, useRef, useState } from 'react'
import { CodeXml, Eye, Layers, RotateCw } from 'lucide-react'
import {
  artifactPreviewHtml,
  artifactResponseSchema,
  artifactBundleSource,
  type Artifact,
  type ArtifactReference,
} from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import { Button, IconButton, MessageResponse } from '@dovo/studio-ui'
import { FloatingPreview, type PreviewPlacement } from '../detail/floating-preview'
import { useArtifactPreviewTheme } from './preview-theme'

export function InlineArtifact({
  reference,
  onOpen,
}: {
  reference: ArtifactReference
  onOpen: () => void
}) {
  const { request, connected } = useWorkspace()
  const previewTheme = useArtifactPreviewTheme()
  const root = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(false)
  const [artifact, setArtifact] = useState<Artifact>()
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [source, setSource] = useState(false)
  const [placement, setPlacement] = useState<PreviewPlacement>('inline')
  useEffect(() => {
    const element = root.current
    if (!element) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin: '200px' },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!visible) return
    let disposed = false
    setError('')
    setArtifact(undefined)
    if (!connected) {
      setError('Reconnect the computer to load this preview.')
      return
    }
    void request(
      '/api/artifacts/read',
      { taskId: reference.taskId, id: reference.id, revision: reference.revision },
      artifactResponseSchema,
    )
      .then(({ artifact }) => {
        if (!disposed) setArtifact(artifact)
      })
      .catch((cause: unknown) => {
        if (!disposed) setError(cause instanceof Error ? cause.message : String(cause))
      })
    return () => {
      disposed = true
    }
  }, [request, connected, visible, reference.taskId, reference.id, reference.revision, reload])
  const sourceArtifact = artifact
    ? artifactBundleSource(artifact, artifact.entrypoint ?? '')
    : undefined
  const interactive = artifact?.format === 'html' || artifact?.format === 'svg'
  return (
    <div
      ref={root}
      className="my-3 min-w-0 overflow-visible rounded-xl border bg-card"
      data-inline-artifact={reference.id}
    >
      <FloatingPreview
        title={reference.title}
        placement={placement}
        onPlacementChange={setPlacement}
        onClose={placement === 'inline' ? undefined : () => setPlacement('inline')}
        actions={
          <>
            <IconButton
              label={source ? 'Show rendered artifact' : 'View artifact source'}
              className="size-7 shrink-0"
              aria-pressed={source}
              onClick={() => setSource((value) => !value)}
            >
              {source ? <Eye size={14} /> : <CodeXml size={14} />}
            </IconButton>
            <IconButton
              label={`Open artifact ${reference.title}`}
              className="size-7 shrink-0"
              onClick={onOpen}
            >
              <Layers size={14} />
            </IconButton>
          </>
        }
      >
        {!artifact && !error && (
          <p role="status" className="p-4 text-xs text-muted-foreground">
            Loading preview…
          </p>
        )}
        {error && (
          <div role="alert" className="p-4 text-xs text-destructive">
            <p>{error}</p>
            <Button
              size="sm"
              variant="outline"
              className="mt-2"
              disabled={!connected}
              onClick={() => setReload((value) => value + 1)}
            >
              <RotateCw size={14} />
              Retry preview
            </Button>
          </div>
        )}
        {artifact && (
          <>
            {interactive && (
              <iframe
                title={artifact.title}
                sandbox="allow-scripts allow-downloads"
                referrerPolicy="no-referrer"
                srcDoc={artifactPreviewHtml(artifact.content, previewTheme)}
                className={source ? 'hidden' : 'min-h-0 w-full flex-1 border-0 bg-background'}
              />
            )}
            {(source || artifact.format === 'code') && (
              <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-4 text-xs">
                <code>{sourceArtifact?.content}</code>
              </pre>
            )}
            {!source && artifact.format === 'markdown' && (
              <div className="min-h-0 flex-1 overflow-auto px-5 py-4 text-sm">
                <MessageResponse>{artifact.content}</MessageResponse>
              </div>
            )}
          </>
        )}
      </FloatingPreview>
      <div className="border-t px-3 py-1 text-[0.625rem] text-muted-foreground">
        {reference.fileCount ? `${reference.fileCount} files · ` : ''}Version {reference.revision}
      </div>
    </div>
  )
}
