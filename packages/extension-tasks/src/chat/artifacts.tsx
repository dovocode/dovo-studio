import { memo, useContext, useEffect, useState } from 'react'
import {
  artifactFile,
  artifactFormatLabels,
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
  EmptyState,
  IconButton,
  MessageResponse,
  cn,
} from '@dovo/studio-ui'
import {
  ArrowUpRight,
  Check,
  CodeXml,
  Copy,
  Download,
  Eye,
  Layers,
  LoaderCircle,
  Maximize2,
  RotateCw,
  X,
} from 'lucide-react'
import { ArtifactIcon } from './artifact-presentation'
import { ArtifactOpenContext } from './artifact-open-context'

export const ArtifactCard = memo(function ArtifactCard({
  reference,
}: {
  reference: ArtifactReference
}) {
  const { activeRuntimeId, snapshot } = useWorkspace()
  const openInThread = useContext(ArtifactOpenContext)
  const [open, setOpen] = useState(false)
  if (!snapshot?.artifactsEnabled) return null
  return (
    <>
      <button
        type="button"
        aria-label={`Open artifact ${reference.title}`}
        className="group my-2 flex w-full max-w-lg items-center gap-3 rounded-xl border bg-card p-3.5 text-left transition-colors hover:border-primary/30 hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => (openInThread ? openInThread(reference) : setOpen(true))}
      >
        <span className="flex size-11 shrink-0 items-center justify-center rounded-lg border bg-background">
          <ArtifactIcon format={reference.format} className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{reference.title}</span>
          <span className="mt-1 block text-xs text-muted-foreground">
            {artifactFormatLabels[reference.format]} · Version {reference.revision}
          </span>
        </span>
        <ArrowUpRight
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
        />
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

export function ThreadArtifacts({
  taskId,
  initialId,
  onClose,
}: {
  taskId: string
  initialId?: string
  onClose?: () => void
}) {
  const { snapshot } = useWorkspace()
  if (!snapshot?.artifactsEnabled) return null
  return <ArtifactBrowser taskId={taskId} initialId={initialId} onClose={onClose} embedded />
}

export function ArtifactBrowser({
  taskId,
  initialId = '',
  embedded = false,
  onClose,
}: {
  taskId: string
  initialId?: string
} & ({ embedded: true; onClose?: () => void } | { embedded?: false; onClose: () => void })) {
  const { request, connected } = useWorkspace()
  const [items, setItems] = useState<ArtifactMetadata[]>()
  const [links, setLinks] = useState<ArtifactLink[]>([])
  const [id, setId] = useState(initialId)
  const link = links.find((item) => item.url === id)
  const metadata = items?.find((item) => item.id === id)
  const [revision, setRevision] = useState<number>()
  const [versions, setVersions] = useState<ArtifactMetadata[]>([])
  const [reload, setReload] = useState(0)
  const selection = JSON.stringify([taskId, id, revision, reload])
  const [loaded, setLoaded] = useState<{ selection: string; artifact: Artifact }>()
  const artifact = loaded?.selection === selection ? loaded.artifact : undefined
  const [listError, setListError] = useState('')
  const [previewError, setPreviewError] = useState('')
  const [actionError, setActionError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const error = listError || previewError || actionError
  const [source, setSource] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 2000)
    return () => clearTimeout(timer)
  }, [copied])
  useEffect(() => {
    let disposed = false
    setListError('')
    if (!connected) {
      setListError('Reconnect the computer to load artifacts.')
      setRefreshing(false)
      return
    }
    setRefreshing(true)
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
      .finally(() => {
        if (!disposed) setRefreshing(false)
      })
    return () => {
      disposed = true
    }
  }, [request, taskId, connected, reload])
  useEffect(() => {
    let disposed = false
    setVersions([])
    setPreviewError('')
    setActionError('')
    setCopied(false)
    if (!id || !metadata || !connected) return
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
  }, [request, taskId, id, metadata?.revision, revision, connected, reload, selection])
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
  const copy = async () => {
    if (!artifact) return
    setActionError('')
    try {
      if (!navigator.clipboard)
        throw new Error('Clipboard unavailable. Download the source instead.')
      await navigator.clipboard.writeText(artifact.content)
      setCopied(true)
    } catch (cause) {
      setActionError(String(cause))
    }
  }
  const title = link?.title ?? artifact?.title ?? metadata?.title ?? 'Artifacts'
  const content = (
    <>
      {(!embedded || expanded) && (
        <>
          <DialogTitle className="sr-only">{title}</DialogTitle>
          <DialogDescription className="sr-only">
            Saved artifacts and links shared in this thread.
          </DialogDescription>
        </>
      )}
      <header
        className={cn(
          'flex shrink-0 items-center gap-3 border-b px-4 py-3',
          (!embedded || expanded) && 'pr-14',
        )}
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-card">
          {metadata ? (
            <ArtifactIcon format={metadata.format} />
          ) : (
            <Layers aria-hidden="true" className="size-4 text-muted-foreground" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <select
            aria-label="Artifact"
            className="w-full min-w-0 truncate rounded bg-background py-0.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={id}
            disabled={!items?.length && !links.length}
            onChange={(event) => {
              setId(event.target.value)
              setRevision(undefined)
              setSource(false)
            }}
          >
            <option value="" disabled>
              Thread artifacts
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
          <p className="mt-0.5 text-xs text-muted-foreground">
            {link
              ? artifactLinkLabel(link.provider)
              : metadata
                ? artifactFormatLabels[metadata.format]
                : 'Saved in this thread'}
            {items &&
              ` · ${items.length + links.length} ${items.length + links.length === 1 ? 'artifact' : 'artifacts'}`}
          </p>
        </div>
        <IconButton
          label="Refresh artifacts"
          disabled={!connected || refreshing}
          onClick={() => setReload((value) => value + 1)}
        >
          <RotateCw className={cn('size-4', refreshing && 'animate-spin')} />
        </IconButton>
        {embedded && !expanded && (
          <IconButton label="Expand artifact" onClick={() => setExpanded(true)}>
            <Maximize2 className="size-4" />
          </IconButton>
        )}
        {embedded && !expanded && onClose && (
          <IconButton label="Close artifacts" onClick={onClose}>
            <X className="size-4" />
          </IconButton>
        )}
      </header>
      {!link && id && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-3 py-2">
          <div
            className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5"
            aria-label="Artifact view"
          >
            {(
              [
                { value: false, label: 'Preview', icon: Eye },
                { value: true, label: 'Source', icon: CodeXml },
              ] as const
            ).map(({ value, label, icon: Icon }) => (
              <Button
                key={label}
                variant="ghost"
                size="sm"
                aria-pressed={source === value}
                disabled={!artifact}
                className={cn('gap-1.5', source === value && 'bg-background shadow-sm')}
                onClick={() => setSource(value)}
              >
                <Icon className="size-3.5" />
                {label}
              </Button>
            ))}
          </div>
          <div className="flex items-center gap-0.5">
            <select
              aria-label="Artifact version"
              className="min-w-0 max-w-36 rounded bg-background py-1 text-xs text-muted-foreground"
              disabled={!versions.length}
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
            <IconButton
              label={copied ? 'Copied source' : 'Copy source'}
              className="size-7"
              onClick={() => void copy()}
              disabled={!artifact}
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </IconButton>
            <IconButton label="Download" className="size-7" onClick={download} disabled={!artifact}>
              <Download className="size-3.5" />
            </IconButton>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="shrink-0 border-b px-4 py-3 text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-auto bg-muted/30">
        {!error && !items && (
          <div
            role="status"
            className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground"
          >
            <LoaderCircle className="size-4 animate-spin" />
            Loading artifacts…
          </div>
        )}
        {items?.length === 0 && links.length === 0 && !listError && (
          <EmptyState
            icon={<Layers />}
            title="No artifacts yet"
            description="Ask your agent to create a document, an interactive preview or a graphic. Artifacts and shared links will appear here."
          />
        )}
        {id && !link && !artifact && !error && items && (
          <div
            role="status"
            className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground"
          >
            <LoaderCircle className="size-4 animate-spin" />
            Loading preview…
          </div>
        )}
        {link && (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl border bg-card">
              <ArrowUpRight className="size-6 text-muted-foreground" />
            </span>
            <div>
              <h2 className="text-base font-medium">{link.title}</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {artifactLinkLabel(link.provider)}
              </p>
            </div>
            <p className="max-w-md break-all text-xs text-muted-foreground">{link.url}</p>
            <Button asChild variant="outline">
              <a href={link.url} target="_blank" rel="noreferrer">
                Open {artifactLinkLabel(link.provider)}
                <ArrowUpRight className="size-4" />
              </a>
            </Button>
          </div>
        )}
        {artifact &&
          (source || artifact.format === 'code' ? (
            <pre className="min-h-full whitespace-pre-wrap break-words bg-background p-5 font-mono text-xs leading-6">
              <code>{artifact.content}</code>
            </pre>
          ) : artifact.format === 'markdown' ? (
            <div className="mx-auto min-h-full max-w-3xl bg-background px-6 py-8 sm:px-10">
              <MessageResponse>{artifact.content}</MessageResponse>
            </div>
          ) : (
            <iframe
              key={`${id}:${artifact.revision}`}
              title={artifact.title}
              className="h-full min-h-80 w-full border-0 bg-white"
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              srcDoc={artifactPreviewHtml(artifact.content)}
            />
          ))}
      </div>
      {artifact && (
        <footer className="flex shrink-0 items-center justify-between gap-3 border-t px-4 py-2 text-[0.6875rem] text-muted-foreground">
          <span>
            {artifact.language || artifactFormatLabels[artifact.format]} · Version{' '}
            {artifact.revision}
            {revision === undefined && ' · Latest'}
          </span>
          <time dateTime={artifact.updatedAt}>
            {new Date(artifact.updatedAt).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
            })}
          </time>
        </footer>
      )}
    </>
  )
  if (embedded && !expanded)
    return (
      <section
        aria-label="Thread artifacts"
        className="flex h-full min-h-0 flex-col overflow-hidden"
      >
        {content}
      </section>
    )
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          if (embedded) setExpanded(false)
          else onClose?.()
        }
      }}
    >
      <DialogContent className="flex h-[88dvh] w-[min(1120px,96vw)] max-w-none flex-col gap-0 overflow-hidden rounded-xl p-0">
        {content}
      </DialogContent>
    </Dialog>
  )
}
