import { useEffect, useState } from 'react'
import { useWorkspace } from '@dovo/studio-core'
import {
  taskImageReadSchema,
  toolImageReferences,
  toolImages,
  toolPresentation,
  type ToolImageReference,
} from '@dovo/protocol'
import { Button, Dialog, DialogContent, DialogTitle } from '@dovo/studio-ui'

function ResultImage({
  taskId,
  label,
  reference,
  uri,
}: {
  taskId: string
  label: string
  reference?: ToolImageReference
  uri?: string
}) {
  const { request, connected, connection } = useWorkspace()
  const [open, setOpen] = useState(false)
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<{ identity: string; uri?: string; error?: string }>()
  const identity = JSON.stringify([
    taskId,
    reference?.eventId,
    reference?.index,
    uri,
    connection?.address,
    connection?.token,
  ])
  const eventId = reference?.eventId,
    index = reference?.index
  useEffect(() => {
    let active = true
    if (uri || !connected || !eventId) return
    void request(
      '/api/tasks/images/read',
      { taskId, eventId, index, maxSize: open ? 2048 : 1024 },
      taskImageReadSchema,
    ).then(
      (value) => {
        if (active) setResult({ identity, uri: value.uri })
      },
      (error: unknown) => {
        if (active)
          setResult({ identity, error: error instanceof Error ? error.message : String(error) })
      },
    )
    return () => {
      active = false
    }
  }, [request, connected, taskId, eventId, index, uri, identity, revision, open])
  const current = result?.identity === identity ? result : undefined
  const image = uri || current?.uri
  const content =
    !uri && !connected ? (
      <p>Reconnect to load {label}.</p>
    ) : current?.error ? (
      <div role="alert">
        {current.error}{' '}
        <Button size="sm" onClick={() => setRevision((value) => value + 1)}>
          Retry {label}
        </Button>
      </div>
    ) : image ? (
      <img src={image} alt={label} className="max-h-96 max-w-full object-contain" />
    ) : (
      <p role="status">Loading {label}…</p>
    )
  return (
    <div className="my-2 min-w-0">
      {image && (uri || connected) ? (
        <button type="button" aria-label={`Preview ${label}`} onClick={() => setOpen(true)}>
          {content}
        </button>
      ) : (
        content
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-5xl">
          <DialogTitle>{label}</DialogTitle>
          {content}
        </DialogContent>
      </Dialog>
    </div>
  )
}

export function ToolResultImages({
  tools,
}: {
  tools: readonly {
    id: string
    scope: string
    payload: string
    summary: string
    inputPayload?: string
  }[]
}) {
  return tools.map((tool) => {
    const references = toolImageReferences(tool.payload, tool.id)
    const images = references.length ? [] : toolImages(tool.payload)
    const label = toolPresentation(tool.payload, tool.summary, tool.inputPayload).title
    return (
      <div key={tool.id}>
        {references.map((reference, index) => (
          <ResultImage
            key={`${reference.eventId}:${reference.index}`}
            taskId={tool.scope}
            reference={reference}
            label={`${label} image ${index + 1}`}
          />
        ))}
        {images.map((image, index) => (
          <ResultImage
            key={index}
            taskId={tool.scope}
            uri={image.uri}
            label={`${label} image ${index + 1}`}
          />
        ))}
      </div>
    )
  })
}
