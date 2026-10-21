import { copyTextToClipboard } from '@dovo/studio-ui/clipboard'
import { memo, useContext, useEffect, useRef, useState } from 'react'
import {
  artifactFile,
  artifactDownloadResponseSchema,
  artifactBundleSource,
  artifactLabel,
  artifactPdfResponseSchema,
  artifactExportPreviewResponseSchema,
  artifactPngResponseSchema,
  type ArtifactPdfOptions,
  artifactHtmlResponseSchema,
  artifactMhtmlResponseSchema,
  artifactSourceMarkdown,
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
  DropdownMenu,
  EmptyState,
  IconButton,
  MessageResponse,
  cn,
} from '@dovo/studio-ui'
import {
  ArrowUpRight,
  ChevronDown,
  Check,
  CodeXml,
  Copy,
  Download,
  FileDown,
  Eye,
  Layers,
  LoaderCircle,
  Maximize2,
  RotateCw,
  X,
} from 'lucide-react'
import { ArtifactExportEditor } from './artifact-export-editor'
import { ArtifactExportOptions } from './artifact-export-options'
import { ArtifactIcon } from './artifact-presentation'
import { InlineArtifact } from './inline-artifact'
import { useArtifactPreviewTheme } from './preview-theme'
import { ArtifactOpenContext } from './artifact-open-context'
import { ArtifactSharing } from './artifact-sharing'

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
      <InlineArtifact
        key={`${activeRuntimeId}:${reference.taskId}:${reference.id}:${reference.revision}`}
        reference={reference}
        onOpen={() => (openInThread ? openInThread(reference) : setOpen(true))}
      />
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
  const previewTheme = useArtifactPreviewTheme()
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
  const [fileSelection, setFileSelection] = useState<{ id: string; path: string }>()
  const selectedFile =
    artifact?.files?.find((file) => fileSelection?.id === id && file.path === fileSelection.path) ??
    artifact?.files?.find((file) => file.path === artifact.entrypoint) ??
    artifact?.files?.[0]
  const sourceArtifact = artifact
    ? artifactBundleSource(artifact, selectedFile?.path ?? '')
    : undefined
  const [listError, setListError] = useState('')
  const [previewError, setPreviewError] = useState('')
  const [versionsError, setVersionsError] = useState('')
  const [actionError, setActionError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const error = listError || previewError || actionError
  const [source, setSource] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  const [exporting, setExporting] = useState<'pdf' | 'png' | 'html' | 'mhtml'>()
  const [exportOptions, setExportOptions] = useState(false)
  const [exportDraft, setExportDraft] = useState<{ key: string; content: string }>()
  const [editingExport, setEditingExport] = useState<{ key: string; content: string }>()
  const [preparingEditor, setPreparingEditor] = useState(false)
  const editorRequest = useRef(false)
  const exportKey = JSON.stringify([taskId, id, artifact?.revision])
  const draftHtml = exportDraft?.key === exportKey ? exportDraft.content : undefined
  const [downloading, setDownloading] = useState(false)
  const exportingRequest = useRef(false)
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
    setVersionsError('')
    void request('/api/artifacts/read', { taskId, id, revision }, artifactResponseSchema)
      .then((result) => {
        if (!disposed) setLoaded({ selection, artifact: result.artifact })
      })
      .catch((cause: unknown) => {
        if (!disposed) setPreviewError(cause instanceof Error ? cause.message : String(cause))
      })
    void request('/api/artifacts/versions', { taskId, id }, artifactVersionsSchema)
      .then((history) => {
        if (!disposed) setVersions(history.versions)
      })
      .catch((cause: unknown) => {
        if (!disposed)
          setVersionsError(
            `Version history unavailable: ${cause instanceof Error ? cause.message : String(cause)}`,
          )
      })
    return () => {
      disposed = true
    }
  }, [request, taskId, id, metadata?.revision, revision, connected, reload, selection])
  const download = async () => {
    if (!artifact || downloading) return
    setDownloading(true)
    setActionError('')
    try {
      const file = artifact.files
        ? await request(
            '/api/artifacts/download',
            { taskId: artifact.taskId, id: artifact.id, revision: artifact.revision },
            artifactDownloadResponseSchema,
          )
        : { ...artifactFile(artifact), data: artifact.content }
      const data = artifact.files
        ? Uint8Array.from(atob(file.data), (char) => char.charCodeAt(0))
        : file.data
      const url = URL.createObjectURL(new Blob([data], { type: file.mime }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = file.name
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setDownloading(false)
    }
  }
  const editExport = async () => {
    if (!artifact || !connected || editorRequest.current) return
    if (draftHtml !== undefined) {
      setEditingExport({ key: exportKey, content: draftHtml })
      return
    }
    editorRequest.current = true
    setPreparingEditor(true)
    setActionError('')
    try {
      const { content } = await request(
        '/api/artifacts/export-preview',
        { taskId: artifact.taskId, id: artifact.id, revision: artifact.revision },
        artifactExportPreviewResponseSchema,
      )
      setEditingExport({ key: exportKey, content })
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      editorRequest.current = false
      setPreparingEditor(false)
    }
  }
  const exportFile = async (
    format: 'pdf' | 'png' | 'html' | 'mhtml',
    options?: ArtifactPdfOptions,
    width?: number,
  ) => {
    if (!artifact || !connected || exportingRequest.current) return
    exportingRequest.current = true
    setExporting(format)
    setActionError('')
    try {
      const input = { taskId: artifact.taskId, id: artifact.id, revision: artifact.revision }
      const edited = draftHtml === undefined ? {} : { draftHtml }
      const result =
        format === 'pdf'
          ? await request(
              '/api/artifacts/pdf',
              { ...input, options, ...edited },
              artifactPdfResponseSchema,
            )
          : format === 'png'
            ? await request('/api/artifacts/png', { ...input, width }, artifactPngResponseSchema)
            : format === 'html'
              ? await request('/api/artifacts/html', input, artifactHtmlResponseSchema)
              : await request(
                  '/api/artifacts/mhtml',
                  { ...input, ...edited },
                  artifactMhtmlResponseSchema,
                )
      const bytes = Uint8Array.from(atob(result.data), (char) => char.charCodeAt(0))
      const url = URL.createObjectURL(new Blob([bytes], { type: result.mime }))
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = result.name
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 30_000)
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      exportingRequest.current = false
      setExporting(undefined)
    }
  }
  const copy = async () => {
    if (!sourceArtifact) return
    setActionError('')
    try {
      await copyTextToClipboard(sourceArtifact.content)
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
                ? artifactLabel(metadata)
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
                  Version {item.revision} · {new Date(item.updatedAt).toLocaleString()}
                </option>
              ))}
            </select>
            {artifact && (
              <ArtifactSharing key={`${artifact.id}:${artifact.revision}`} artifact={artifact} />
            )}
            <IconButton
              label={copied ? 'Copied source' : 'Copy source'}
              className="size-7"
              onClick={() => void copy()}
              disabled={!artifact || selectedFile?.encoding === 'base64'}
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </IconButton>
            <IconButton
              label="Export PDF or PNG"
              type="button"
              className="size-7"
              onClick={() => setExportOptions((value) => !value)}
              disabled={!artifact || !connected || !!exporting}
            >
              {exporting === 'pdf' || exporting === 'png' ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <FileDown className="size-3.5" />
              )}
            </IconButton>
            <IconButton
              label={artifact?.files ? 'Download folder' : 'Download'}
              className="size-7"
              onClick={() => void download()}
              disabled={!artifact || downloading || (!!artifact.files && !connected)}
            >
              <Download className="size-3.5" />
            </IconButton>
          </div>
        </div>
      )}
      {artifact?.files && (
        <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2 text-xs">
          <span className="shrink-0 text-muted-foreground">Files</span>
          <select
            aria-label="Artifact file"
            className="min-w-0 flex-1 truncate rounded bg-background py-1"
            value={selectedFile?.path ?? ''}
            onChange={(event) => {
              setFileSelection({ id, path: event.target.value })
              setSource(true)
              setCopied(false)
            }}
          >
            {artifact.files.map((file) => (
              <option key={file.path} value={file.path}>
                {file.path}
              </option>
            ))}
          </select>
          <span className="shrink-0 text-muted-foreground">{artifact.files.length} files</span>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 px-2 text-xs"
                aria-label="Export folder"
                disabled={!connected || !!exporting}
                aria-busy={!!exporting}
              >
                {exporting && exporting !== 'pdf' ? (
                  <>
                    <LoaderCircle className="size-3 animate-spin" />
                    Exporting…
                  </>
                ) : (
                  <>
                    Export <ChevronDown className="size-3" />
                  </>
                )}
              </Button>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content
                align="end"
                sideOffset={4}
                className="z-50 min-w-56 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md"
              >
                <DropdownMenu.Item
                  className="cursor-pointer rounded px-3 py-2 text-xs outline-none focus:bg-accent"
                  onSelect={() => void exportFile('html')}
                >
                  <span className="block font-medium">Interactive HTML</span>
                  <span className="block text-muted-foreground">
                    One file with working controls
                  </span>
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className="cursor-pointer rounded px-3 py-2 text-xs outline-none focus:bg-accent"
                  disabled={preparingEditor}
                  onSelect={() => void editExport()}
                >
                  Edit before export…
                </DropdownMenu.Item>
                <DropdownMenu.Item
                  className="cursor-pointer rounded px-3 py-2 text-xs outline-none focus:bg-accent"
                  onSelect={() => void exportFile('mhtml')}
                >
                  <span className="block font-medium">MHTML snapshot</span>
                  <span className="block text-muted-foreground">
                    Offline page archive without interaction
                  </span>
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </div>
      )}
      {artifact && !link && (exportOptions || draftHtml !== undefined) && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-2 text-xs">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={!connected || !!exporting || preparingEditor}
            onClick={() => void editExport()}
          >
            {preparingEditor ? 'Preparing editor…' : 'Edit before export'}
          </Button>
          <span className="text-muted-foreground">
            {draftHtml !== undefined
              ? 'Edited copy · PDF / MHTML only'
              : 'Temporary edits for PDF / MHTML'}
          </span>
          {draftHtml !== undefined && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              disabled={!!exporting}
              onClick={() => setExportDraft(undefined)}
            >
              Reset edits
            </Button>
          )}
        </div>
      )}
      {editingExport && (
        <ArtifactExportEditor
          content={editingExport.content}
          onAction={(edit) => {
            if (edit.action === 'apply')
              setExportDraft({ key: editingExport.key, content: edit.content })
            setEditingExport(undefined)
          }}
        />
      )}
      {exportOptions && !link && (
        <ArtifactExportOptions
          busy={!!exporting}
          disabled={!artifact || !connected}
          onPdf={(options) => void exportFile('pdf', options)}
          onPng={(width) => void exportFile('png', undefined, width)}
          onClose={() => setExportOptions(false)}
        />
      )}
      {versionsError && (
        <p role="alert" className="border-b px-4 py-2 text-xs text-muted-foreground">
          {versionsError}
        </p>
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
        {artifact && (
          <>
            <div hidden={source || artifact.format === 'code'} className="h-full">
              {artifact.format === 'markdown' ? (
                <div className="mx-auto min-h-full max-w-3xl bg-background px-6 py-8 sm:px-10">
                  <MessageResponse>{artifact.content}</MessageResponse>
                </div>
              ) : artifact.format !== 'code' ? (
                <iframe
                  key={`${id}:${artifact.revision}`}
                  title={artifact.title}
                  className="h-full min-h-80 w-full border-0 bg-background"
                  sandbox="allow-scripts allow-downloads"
                  referrerPolicy="no-referrer"
                  srcDoc={artifactPreviewHtml(artifact.content, previewTheme)}
                />
              ) : null}
            </div>
            {(source || artifact.format === 'code') && sourceArtifact && (
              <div className="min-h-full bg-background p-5 font-mono text-xs leading-6">
                {sourceArtifact.content.length <= 1024 * 1024 ? (
                  <MessageResponse>{artifactSourceMarkdown(sourceArtifact)}</MessageResponse>
                ) : (
                  <pre className="whitespace-pre-wrap break-words">
                    <code>{sourceArtifact.content}</code>
                  </pre>
                )}
              </div>
            )}
          </>
        )}
      </div>
      {artifact && (
        <footer className="flex shrink-0 items-center justify-between gap-3 border-t px-4 py-2 text-[0.6875rem] text-muted-foreground">
          <span>
            {artifact.language || artifactLabel(artifact)} · Version {artifact.revision}
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
