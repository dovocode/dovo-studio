import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createRuntimeClient, taskFileShareSchema } from '@dovo/protocol'
import { useStudioHost, useWorkspaceSelector, sameWorkspaceFields } from '@dovo/studio-core'
import { selectConversationConnection } from './workspace-selection'

/** Fetch only a runtime-issued file ticket. The native bridge accepts bytes, never a host path. */
export function NativeFileDrag({
  taskId,
  path,
  children,
}: {
  taskId: string
  path: string
  children: ReactNode
}) {
  const { fileDrag } = useStudioHost()
  const { request, connection, connected } = useWorkspaceSelector(
    selectConversationConnection,
    sameWorkspaceFields,
  )
  const [prepared, setPrepared] = useState<{ id: string; until: number }>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(false)
  const generation = useRef(0)
  useEffect(() => {
    setPrepared(undefined)
    setBusy(false)
    setError('')
    return () => {
      generation.current++
    }
  }, [taskId, path, connection])
  const prepare = async (force = false) => {
    if (
      !fileDrag ||
      !connection ||
      !connected ||
      pending.current ||
      (!force && prepared && prepared.until > Date.now())
    )
      return
    pending.current = true
    setBusy(true)
    setError('')
    const version = generation.current
    try {
      const ticket = await request('/api/tasks/files/share', { taskId, path }, taskFileShareSchema)
      const response = await fetch(
        createRuntimeClient(connection).url(ticket.url + '?download=1'),
        { signal: AbortSignal.timeout(30_000), redirect: 'error' },
      )
      if (!response.ok || !response.body) throw new Error('Could not load this file for dragging.')
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let length = 0
      try {
        while (true) {
          const item = await reader.read()
          if (item.done) break
          length += item.value.byteLength
          if (length > 32 * 1024 * 1024)
            throw new Error('Drag files must be at most 32 MB. Use Download for this file.')
          chunks.push(item.value)
        }
      } finally {
        await reader.cancel()
      }
      const bytes = new Uint8Array(length)
      let offset = 0
      for (const chunk of chunks) {
        bytes.set(chunk, offset)
        offset += chunk.byteLength
      }
      if (version !== generation.current) return
      const id = await fileDrag.prepare(path.split(/[\\/]/).pop() || 'file', bytes)
      if (version === generation.current) setPrepared({ id, until: Date.now() + 14 * 60_000 })
    } catch (cause) {
      if (version === generation.current)
        setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      pending.current = false
      if (version === generation.current) setBusy(false)
    }
  }
  if (!fileDrag) return children
  return (
    <div onPointerEnter={() => void prepare()} onFocus={() => void prepare()}>
      <div
        draggable={!!prepared}
        onDragStart={(event) => {
          event.preventDefault()
          if (!prepared || prepared.until <= Date.now()) {
            setPrepared(undefined)
            void prepare()
            return
          }
          try {
            fileDrag.start(prepared.id)
          } catch (cause) {
            setError(String(cause))
            setPrepared(undefined)
          }
        }}
      >
        {children}
      </div>
      <button
        type="button"
        className="text-xs text-muted-foreground"
        disabled={busy || !connected}
        onClick={() => {
          setPrepared(undefined)
          void prepare(true)
        }}
      >
        {busy
          ? 'Preparing drag…'
          : prepared
            ? 'Drag the file card to your file manager'
            : 'Prepare file to drag'}
      </button>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
