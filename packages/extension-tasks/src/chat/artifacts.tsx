import { memo, useEffect, useState } from 'react'
import {
  artifactFile,
  artifactListSchema,
  artifactLinkLabel,
  artifactPreviewHtml,
  artifactResponseSchema,
  artifactVersionsSchema,
  type Artifact,
  type ArtifactMetadata,
  type ArtifactReference,
  type ArtifactLink,
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
export function ThreadArtifacts({ taskId }: { taskId: string }) {
  const { snapshot } = useWorkspace()
  if (!snapshot?.artifactsEnabled) return null
  return <ArtifactBrowser taskId={taskId} embedded />
}
function ArtifactBrowser({
  taskId,
  initialId = '',
  embedded = false,
  onClose,
}: {
  taskId: string
  initialId?: string
} & ({ embedded: true; onClose?: never } | { embedded?: false; onClose: () => void })) {
  const { request, connected } = useWorkspace()
  const [items, setItems] = useState<ArtifactMetadata[]>()
  const [links, setLinks] = useState<ArtifactLink[]>([])
  const [id, setId] = useState(initialId)
  const link = links.find((item) => item.url === id)
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
      .then(({ artifacts, links = [] }) => {
        if (disposed) return
        setItems(artifacts)
        setLinks(links)
        setId((previous) =>
          artifacts.some((item) => item.id === previous) ||
          links.some((item) => item.url === previous)
            ? previous
            : artifacts[0]?.id || links[0]?.url || '',
        )
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
    setPreviewError('')
    if (!id || link || !connected) return
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
  }, [request, taskId, id, link?.url, revision, connected, reload, selection])
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
  const content = (
    <>
      {embedded ? (
        <header>
          <h2 className="text-sm font-medium">
            {link?.title ?? artifact?.title ?? 'Thread artifacts'}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Saved artifacts and links shared in this thread.
          </p>
        </header>
      ) : (
        <>
          <DialogTitle>{link?.title ?? artifact?.title ?? 'Thread artifacts'}</DialogTitle>
          <DialogDescription>Saved artifacts and links shared in this thread.</DialogDescription>
        </>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Artifact"
          className="min-w-0 max-w-full rounded border bg-background p-2 text-sm"
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
          {links.map((item) => (
            <option key={item.url} value={item.url}>
              {item.title} · {artifactLinkLabel(item.provider)}
            </option>
          ))}
        </select>
        {!link && (
          <>
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
          </>
        )}
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
      {items?.length === 0 && links.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No artifacts yet. Create an artifact or share a Claude artifact or ChatGPT Site link.
        </p>
      )}
      {id && !link && !artifact && !error && <p>Loading preview…</p>}
      {link && (
        <div className="flex flex-col gap-3 rounded border p-4">
          <p className="text-xs text-muted-foreground">{artifactLinkLabel(link.provider)}</p>
          <p className="break-all text-sm">{link.url}</p>
          <Button asChild variant="outline" size="sm">
            <a href={link.url} target="_blank" rel="noreferrer">
              Open {artifactLinkLabel(link.provider)}
            </a>
          </Button>
        </div>
      )}
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
    </>
  )
  if (embedded)
    return (
      <section aria-label="Thread artifacts" className="flex h-full min-h-0 flex-col gap-3 p-4">
        {content}
      </section>
    )
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose?.()
      }}
    >
      <DialogContent className="flex h-[85vh] w-[min(1100px,95vw)] max-w-none flex-col gap-3">
        {content}
      </DialogContent>
    </Dialog>
  )
}
