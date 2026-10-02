import { memo, useEffect, useState } from 'react'
import {
  artifactFile,
  artifactListSchema,
  artifactPreviewHtml,
  artifactResponseSchema,
  artifactVersionsSchema,
  type Artifact,
  type ArtifactMetadata,
  type ArtifactReference,
} from '@dovo/protocol'
import { useWorkspace } from '@dovo/studio-core'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  MessageResponse,
} from '@dovo/studio-ui'
import { FileCode2 } from 'lucide-react'

export const ArtifactCard = memo(function ArtifactCard({
  reference,
}: {
  reference: ArtifactReference
}) {
  const { activeRuntimeId, snapshot } = useWorkspace()
  const [open, setOpen] = useState(false)
  if (!snapshot?.artifactsEnabled) return null
  return (
    <>
      <button
        type="button"
        className="my-2 flex w-full items-center gap-3 rounded-lg border bg-card p-3 text-left hover:bg-accent"
        onClick={() => setOpen(true)}
      >
        <FileCode2 className="size-5 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{reference.title}</span>
          <span className="text-xs text-muted-foreground">
            {reference.format} · Version {reference.revision} · Open artifact
          </span>
        </span>
      </button>
      {open && (
        <ArtifactBrowser
          key={`${activeRuntimeId}:${reference.taskId}`}
          taskId={reference.taskId}
          initialId={reference.id}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
})
export function ArtifactLibrary({ taskId }: { taskId: string }) {
  const { activeRuntimeId, snapshot } = useWorkspace()
  const [open, setOpen] = useState(false)
  if (!snapshot?.artifactsEnabled) return null
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Artifacts
      </Button>
      {open && (
        <ArtifactBrowser
          key={`${activeRuntimeId}:${taskId}`}
          taskId={taskId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}
function ArtifactBrowser({
  taskId,
  initialId = '',
  onClose,
}: {
  taskId: string
  initialId?: string
  onClose: () => void
}) {
  const { request, connected } = useWorkspace()
  const [items, setItems] = useState<ArtifactMetadata[]>()
  const [id, setId] = useState(initialId)
  const [revision, setRevision] = useState<number>()
  const [versions, setVersions] = useState<ArtifactMetadata[]>([])
  const [reload, setReload] = useState(0)
  const selection = JSON.stringify([taskId, id, revision, reload])
  const [loaded, setLoaded] = useState<{ selection: string; artifact: Artifact }>()
  const artifact = loaded?.selection === selection ? loaded.artifact : undefined
  const [listError, setListError] = useState('')
  const [previewError, setPreviewError] = useState('')
  const error = listError || previewError
  const [source, setSource] = useState(false)
  useEffect(() => {
    let disposed = false
    setListError('')
    if (!connected) {
      setListError('Reconnect the runtime to load artifacts.')
      return
    }
    void request('/api/artifacts/list', { taskId }, artifactListSchema)
      .then(({ artifacts }) => {
        if (disposed) return
        setItems(artifacts)
        setId((previous) => previous || artifacts[0]?.id || '')
      })
      .catch((cause: unknown) => {
        if (!disposed) setListError(String(cause))
      })
    return () => {
      disposed = true
    }
  }, [request, taskId, connected, reload])
  useEffect(() => {
    let disposed = false
    setVersions([])
    if (!id || !connected) return
    setPreviewError('')
    void Promise.all([
      request('/api/artifacts/read', { taskId, id, revision }, artifactResponseSchema),
      request('/api/artifacts/versions', { taskId, id }, artifactVersionsSchema),
    ])
      .then(([result, history]) => {
        if (!disposed) {
          setLoaded({ selection, artifact: result.artifact })
          setVersions(history.versions)
        }
      })
      .catch((cause: unknown) => {
        if (!disposed) setPreviewError(String(cause))
      })
    return () => {
      disposed = true
    }
  }, [request, taskId, id, revision, connected, reload, selection])
  const download = () => {
    if (!artifact) return
    const file = artifactFile(artifact)
    const url = URL.createObjectURL(new Blob([artifact.content], { type: file.mime }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = file.name
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 30_000)
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="flex h-[85vh] w-[min(1100px,95vw)] max-w-none flex-col gap-3">
        <DialogTitle>{artifact?.title ?? 'Thread artifacts'}</DialogTitle>
        <DialogDescription>
          Saved in this thread. Earlier versions remain available.
        </DialogDescription>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Artifact"
            className="max-w-80 rounded border bg-background p-2 text-sm"
            value={id}
            onChange={(event) => {
              setId(event.target.value)
              setRevision(undefined)
              setSource(false)
            }}
          >
            <option value="" disabled>
              Select artifact
            </option>
            {items?.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
          <select
            aria-label="Artifact version"
            className="rounded border bg-background p-2 text-sm"
            value={revision ?? ''}
            onChange={(event) =>
              setRevision(event.target.value ? Number(event.target.value) : undefined)
            }
          >
            <option value="">Latest version</option>
            {versions.map((item) => (
              <option key={item.revision} value={item.revision}>
                Version {item.revision}
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSource((value) => !value)}
            disabled={!artifact}
          >
            {source ? 'Preview' : 'Source'}
          </Button>
          <Button variant="outline" size="sm" onClick={download} disabled={!artifact}>
            Download
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setReload((value) => value + 1)}
            disabled={!connected}
          >
            Refresh
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {!error && !items && <p>Loading artifacts…</p>}
        {items?.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No artifacts yet. Ask the agent to create a document, diagram or interactive preview.
          </p>
        )}
        {id && !artifact && !error && <p>Loading preview…</p>}
        {artifact && (
          <div className="min-h-0 flex-1 overflow-auto rounded border">
            {source || artifact.format === 'code' ? (
              <pre className="whitespace-pre-wrap break-words p-4 text-sm">
                <code>{artifact.content}</code>
              </pre>
            ) : artifact.format === 'markdown' ? (
              <div className="p-5">
                <MessageResponse>{artifact.content}</MessageResponse>
              </div>
            ) : (
              <iframe
                key={`${id}:${artifact.revision}`}
                title={artifact.title}
                className="h-full min-h-96 w-full border-0 bg-white"
                sandbox="allow-scripts"
                referrerPolicy="no-referrer"
                srcDoc={artifactPreviewHtml(artifact.content)}
              />
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
