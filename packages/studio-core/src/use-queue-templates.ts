import { useRef, useState } from 'react'
import {
  queueTemplateListSchema,
  randomUUID,
  responses,
  type queueTemplateCommandSchema,
  type QueueTemplate,
} from '@dovo/protocol'
import type { WorkspaceRequest } from './workspace/context'

type Command = typeof queueTemplateCommandSchema.Type

export function useQueueTemplates(
  taskId: string,
  repositoryId: string,
  read: WorkspaceRequest,
  write: WorkspaceRequest,
) {
  const [templates, setTemplates] = useState<QueueTemplate[]>()
  const [selectedId, select] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const lock = useRef(false)
  const lastSave = useRef<{ key: string; id: string } | undefined>(undefined)
  const stageRequests = useRef(new Map<string, string>())
  const selected = templates?.find((template) => template.id === selectedId)
  async function perform(action: () => Promise<void>) {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
      lock.current = false
    }
  }
  async function load() {
    const { templates } = await read(
      '/api/tasks/queue-templates/list',
      { repositoryId },
      queueTemplateListSchema,
    )
    setTemplates(templates)
    select((id) =>
      templates.some((template) => template.id === id) ? id : (templates[0]?.id ?? ''),
    )
  }
  const writeCommand = (command: Command) =>
    write('/api/tasks/queue-templates', command, responses.ok)
  return {
    open,
    busy,
    error,
    templates,
    selected,
    select,
    show: () => {
      setOpen(true)
      void perform(load)
    },
    close: () => {
      if (!lock.current) setOpen(false)
    },
    refresh: () => perform(load),
    save: (name: string, queueFingerprint: string) =>
      perform(async () => {
        const key = JSON.stringify([name.trim(), queueFingerprint])
        if (lastSave.current?.key !== key) lastSave.current = { key, id: randomUUID() }
        const id = lastSave.current.id
        await writeCommand({ action: 'save', taskId, id, name, queueFingerprint })
        await load()
        select(id)
        lastSave.current = undefined
      }),
    stage: () =>
      perform(async () => {
        if (!selected) return
        const requestId = stageRequests.current.get(selected.id) ?? randomUUID()
        stageRequests.current.set(selected.id, requestId)
        await writeCommand({ action: 'stage', taskId, id: selected.id, requestId })
        stageRequests.current.delete(selected.id)
        setOpen(false)
      }),
    remove: () =>
      perform(async () => {
        if (!selected) return
        await writeCommand({ action: 'delete', taskId, id: selected.id })
        await load()
      }),
  }
}
