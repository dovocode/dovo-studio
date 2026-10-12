import { TaskVisualization } from './task-visualization'
import { useEffect, useMemo, useState, useCallback, type ComponentProps } from 'react'
import {
  MessageResponse,
  FileTypeIcon,
  Button,
  DropdownMenu,
  RepositoryOpenItems,
  Dialog,
  DialogContent,
  DialogTitle,
} from '@dovo/studio-ui'
import { useWorkspace, useStudioHost } from '@dovo/studio-core'
import {
  taskFileShareSchema,
  taskImageReadSchema,
  richMarkdown,
  localMarkdownPath,
  markdownFileName,
  artifactTemplatePrompt,
  responses,
} from '@dovo/protocol'

function TaskImage({
  taskId,
  path,
  alt,
  onPreview,
}: {
  taskId: string
  path: string
  alt: string
  onPreview: (path: string) => void
}) {
  const { request, connection, connected } = useWorkspace()
  const [result, setResult] = useState<{ key: string; uri?: string; error?: string }>()
  const [revision, setRevision] = useState(0)
  const key = JSON.stringify([taskId, path, connection?.address, connection?.token])
  useEffect(() => {
    let active = true
    if (!connected) return
    void request(
      '/api/tasks/images/read',
      { taskId, path, maxSize: 1024 },
      taskImageReadSchema,
    ).then(
      ({ uri }) => {
        if (active) setResult({ key, uri })
      },
      (error: unknown) => {
        if (active)
          setResult({ key, error: error instanceof Error ? error.message : String(error) })
      },
    )
    return () => {
      active = false
    }
  }, [request, connected, taskId, path, key, revision])
  const current = result?.key === key ? result : undefined
  if (!connected) return <span>Reconnect to load {alt}.</span>
  if (current?.error)
    return (
      <span role="alert">
        {current.error}{' '}
        <button type="button" onClick={() => setRevision((value) => value + 1)}>
          Retry
        </button>{' '}
        <button type="button" onClick={() => onPreview(path)}>
          Open original
        </button>
      </span>
    )
  return current?.uri ? (
    <button type="button" aria-label={`Preview ${alt}`} onClick={() => onPreview(path)}>
      <img src={current.uri} alt={alt} className="max-h-96 max-w-full object-contain" />
    </button>
  ) : (
    <span role="status">Loading {alt}…</span>
  )
}
export function TaskMessageResponse({
  taskId,
  onUseTemplate,
  children,
  ...props
}: ComponentProps<typeof MessageResponse> & {
  taskId: string
  onUseTemplate?: (prompt: string) => void
}) {
  const { request, connection, connected } = useWorkspace()
  const { openExternalLink } = useStudioHost()
  const [error, setError] = useState('')
  const [previewPath, setPreviewPath] = useState<string>()
  const openFile = useCallback(
    (path: string, download = false) => {
      setError('')
      if (!connected || !connection) {
        setError('Reconnect to the file’s computer to preview it.')
        return
      }
      if (!download) {
        setPreviewPath(path)
        return
      }
      // Open synchronously so web browsers do not reject an async popup.
      const preview = openExternalLink ? null : window.open('about:blank', '_blank')
      if (preview) preview.opener = null
      void request('/api/tasks/files/share', { taskId, path }, taskFileShareSchema)
        .then(async (result) => {
          const url = new URL(
            result.url + (download ? '?download=1' : ''),
            connection.address,
          ).toString()
          if (openExternalLink) await openExternalLink(url)
          else if (preview) preview.location.href = url
          else throw new Error('Allow popups to open this file preview.')
        })
        .catch((cause: unknown) => {
          preview?.close()
          setError(cause instanceof Error ? cause.message : String(cause))
        })
    },
    [request, connection, connected, taskId, openExternalLink],
  )
  const localFiles = useMemo(
    () => ({
      open: (path: string) => openFile(path),
      image: (path: string, alt: string) => (
        <TaskImage taskId={taskId} path={path} alt={alt} onPreview={openFile} />
      ),
    }),
    [taskId, openFile],
  )
  const parts = useMemo(() => richMarkdown(children), [children])
  const fileCard = (path: string, label: string) => (
    <div className="my-2 flex min-w-0 max-w-full flex-wrap items-center gap-2 rounded-xl border bg-card/60 p-3">
      <button
        type="button"
        aria-label={`Preview ${label}`}
        title={path}
        onClick={() => openFile(path)}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        <FileTypeIcon path={path} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{label}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {markdownFileName(path)} · Preview file
          </span>
        </span>
      </button>
      <Button size="sm" variant="ghost" onClick={() => openFile(path, true)}>
        Download
      </Button>
      <DropdownMenu.Root>
        <DropdownMenu.Trigger asChild>
          <Button size="sm" variant="ghost">
            Open in…
          </Button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="z-50 min-w-48 rounded-md border bg-popover p-1 text-xs shadow-md">
            <p className="px-2 py-1 text-muted-foreground">On the runtime computer</p>
            <RepositoryOpenItems
              itemClass="flex cursor-default items-center gap-2 rounded px-2 py-1.5 outline-none focus:bg-accent"
              onSelect={(target) => {
                void request('/api/tasks/files/open', { taskId, path, target }, responses.ok).catch(
                  (cause: unknown) =>
                    setError(cause instanceof Error ? cause.message : String(cause)),
                )
              }}
            />
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  )
  return (
    <div className="min-w-0 max-w-full">
      {previewPath && (
        <TaskFileDialog
          taskId={taskId}
          path={previewPath}
          onClose={() => setPreviewPath(undefined)}
        />
      )}
      {parts.map((part) => (
        <div key={part.offset} className="min-w-0 max-w-full">
          {part.kind === 'markdown' ? (
            <MessageResponse {...props} localFiles={localFiles}>
              {part.text}
            </MessageResponse>
          ) : part.kind === 'visualization' ? (
            <TaskVisualization taskId={taskId} path={part.path} label={part.label} />
          ) : part.kind === 'template' ? (
            <div
              role="group"
              aria-label={`${part.template.name} template`}
              className="my-2 flex flex-wrap items-center gap-3 rounded-xl border bg-card/60 p-3"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{part.template.name}</span>
                <span className="text-xs text-muted-foreground">
                  {part.template.kind.replaceAll('-', ' ')} template
                </span>
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const prompt = artifactTemplatePrompt(part.template)
                  if (onUseTemplate) onUseTemplate(prompt)
                  else
                    void navigator.clipboard
                      .writeText(prompt)
                      .catch((cause: unknown) => setError(String(cause)))
                }}
              >
                {onUseTemplate ? 'Use template' : 'Copy template prompt'}
              </Button>
            </div>
          ) : part.kind === 'image' ? (
            localMarkdownPath(part.path) !== undefined ? (
              <TaskImage taskId={taskId} path={part.path} alt={part.label} onPreview={openFile} />
            ) : (
              <a href={part.path} target="_blank" rel="noreferrer">
                <img
                  loading="lazy"
                  src={part.path}
                  alt={part.label}
                  className="max-h-96 max-w-full rounded-lg object-contain"
                />
              </a>
            )
          ) : part.kind === 'video' ? (
            <TaskVideo taskId={taskId} path={part.path} label={part.label} onPreview={openFile} />
          ) : (
            fileCard(part.path, part.label)
          )}
        </div>
      ))}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

function TaskVideo({
  taskId,
  path,
  label,
  onPreview,
}: {
  taskId: string
  path: string
  label: string
  onPreview: (path: string) => void
}) {
  const { request, connection, connected } = useWorkspace()
  const [revision, setRevision] = useState(0)
  const [source, setSource] = useState<{ key: string; url?: string; error?: string }>()
  const key = JSON.stringify([taskId, path, connection?.address, connection?.token])
  const local = localMarkdownPath(path) !== undefined
  useEffect(() => {
    if (!local || !connected || !connection) return
    let active = true
    void request('/api/tasks/files/share', { taskId, path }, taskFileShareSchema).then(
      (result) => {
        if (active)
          setSource({ key, url: new URL(result.url + '?content=1', connection.address).toString() })
      },
      (cause: unknown) => {
        if (active) setSource({ key, error: String(cause) })
      },
    )
    return () => {
      active = false
    }
  }, [local, connected, connection, request, taskId, path, key, revision])
  const current = source?.key === key ? source : undefined
  const url = local ? current?.url : path
  return (
    <figure className="my-2 max-w-full">
      {url && !current?.error ? (
        <video
          controls
          preload="metadata"
          aria-label={label}
          src={url}
          onError={() =>
            setSource({
              key,
              error: 'Could not play this video. Open its preview to download the original.',
            })
          }
          className="max-h-96 max-w-full rounded-lg"
        />
      ) : (
        <p role={current?.error ? 'alert' : 'status'}>
          {current?.error || (connected ? `Loading ${label}…` : 'Reconnect to load video.')}
        </p>
      )}
      <figcaption className="flex items-center gap-2 text-xs text-muted-foreground">
        {label}
        {current?.error && (
          <button
            type="button"
            onClick={() => {
              setSource(undefined)
              setRevision((value) => value + 1)
            }}
          >
            Retry video
          </button>
        )}
        {local && (
          <button type="button" className="text-primary" onClick={() => onPreview(path)}>
            Preview & download
          </button>
        )}
      </figcaption>
    </figure>
  )
}

function TaskFileDialog({
  taskId,
  path,
  onClose,
}: {
  taskId: string
  path: string
  onClose: () => void
}) {
  const { request, connection, connected } = useWorkspace()
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<{ key: string; url?: string; error?: string }>()
  const key = JSON.stringify([taskId, path, connection?.address, connection?.token, revision])
  useEffect(() => {
    if (!connected || !connection) return
    let active = true
    void request('/api/tasks/files/share', { taskId, path }, taskFileShareSchema).then(
      ({ url }) => {
        if (active) setResult({ key, url: new URL(url, connection.address).toString() })
      },
      (cause: unknown) => {
        if (active)
          setResult({ key, error: cause instanceof Error ? cause.message : String(cause) })
      },
    )
    return () => {
      active = false
    }
  }, [request, connected, connection, taskId, path, key])
  const current = result?.key === key ? result : undefined
  const error = !connected ? 'Reconnect to the file’s computer to preview it.' : current?.error
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="flex h-[85dvh] max-w-5xl flex-col" aria-describedby={undefined}>
        <DialogTitle>{markdownFileName(path)}</DialogTitle>
        {error ? (
          <div role="alert">
            <p>{error}</p>
            <Button variant="outline" onClick={() => setRevision((value) => value + 1)}>
              Retry preview
            </Button>
          </div>
        ) : current?.url ? (
          <iframe
            title="File preview"
            src={current.url}
            referrerPolicy="no-referrer"
            className="min-h-0 w-full flex-1 rounded-md border"
          />
        ) : (
          <p role="status">Loading preview…</p>
        )}
      </DialogContent>
    </Dialog>
  )
}
