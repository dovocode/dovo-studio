import { randomUUID } from '@dovo/protocol'
import { draftAttachments, type LocalAttachment } from './draft-attachments'
import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect, useRef, useState } from 'react'
import {
  attachmentUploadResultSchema,
  attachmentMutationSchema,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  type Task,
} from '@dovo/studio-core'
import { useWorkspace } from '@dovo/studio-core'
export function useAttachments(task: Task) {
  const { request, snapshot, connected } = useWorkspace()
  const lock = useRef(false)
  const urls = useRef(new Set<string>())
  const [uploads, setUploads] = useState<LocalAttachment[]>([])
  useEffect(
    () => () => {
      for (const url of urls.current) URL.revokeObjectURL(url)
      urls.current.clear()
    },
    [],
  )
  const [working, setWorking] = useApplicationState(false),
    [error, setError] = useApplicationState(''),
    [pending, setPending] = useApplicationState<number | null>(null)
  const savedFiles =
    (snapshot?.workspace.tasks.find((t) => t.id === task.id) ?? task).draftAttachments ?? []
  useEffect(() => {
    if (!connected || (pending !== null && snapshot && snapshot.revision >= pending))
      setPending(null)
  }, [snapshot, connected, pending])
  const files = draftAttachments(savedFiles, uploads, snapshot?.revision)
  const previews = new Map(
    uploads.flatMap((item) => (item.url ? [[item.attachment.id, item.url] as const] : [])),
  )
  const uploading = uploads.filter((item) => item.revision === undefined)
  useEffect(() => {
    if (!snapshot) return
    const removed = uploads.filter(
      (item) =>
        item.revision !== undefined &&
        snapshot.revision >= item.revision &&
        !savedFiles.some((file) => file.id === item.attachment.id),
    )
    if (!removed.length) return
    for (const item of removed)
      if (item.url) {
        URL.revokeObjectURL(item.url)
        urls.current.delete(item.url)
      }
    setUploads((current) =>
      current.filter((item) => !removed.some((old) => old.attachment.id === item.attachment.id)),
    )
  }, [snapshot, uploads, savedFiles])
  const upload = async (selected: File[]) => {
    if (lock.current) {
      setError('Wait for the current attachment operation to finish.')
      return
    }
    lock.current = true
    setWorking(true)
    setError('')
    try {
      if (files.length + selected.length > MAX_ATTACHMENTS)
        throw new Error('Attach up to 5 files per message.')
      if (selected.some((file) => file.size > MAX_ATTACHMENT_BYTES))
        throw new Error('Each attachment must be 4 MB or smaller.')
      const batch = selected.map((file) => {
        const attachment = {
          id: randomUUID(),
          name: file.name,
          mime: file.type,
          size: file.size,
        }
        const url = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
        if (url) urls.current.add(url)
        return { file, attachment, url }
      })
      setUploads((current) => [
        ...current,
        ...batch.map(({ attachment, url }) => ({ attachment, url })),
      ])
      await Promise.all(
        batch.map(async ({ file, attachment, url }) => {
          try {
            const data = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader()
              reader.onload = () =>
                typeof reader.result === 'string'
                  ? resolve(reader.result.slice(reader.result.indexOf(',') + 1))
                  : reject(new Error('Could not read file'))
              reader.onerror = () => reject(reader.error ?? new Error('Could not read file'))
              reader.readAsDataURL(file)
            })
            const result = await request(
              '/api/attachments/upload',
              {
                taskId: task.id,
                id: attachment.id,
                name: file.name,
                data,
              },
              attachmentUploadResultSchema,
            )
            setUploads((current) =>
              current.map((item) =>
                item.attachment.id === attachment.id
                  ? { ...item, attachment: result.attachment, revision: result.revision }
                  : item,
              ),
            )
          } catch (error) {
            setUploads((current) => current.filter((item) => item.attachment.id !== attachment.id))
            if (url) {
              URL.revokeObjectURL(url)
              urls.current.delete(url)
            }
            setError((current) =>
              [current, `${file.name}: ${String(error)}`].filter(Boolean).join('\n'),
            )
          }
        }),
      )
    } catch (error) {
      setError(String(error))
    } finally {
      setWorking(false)
      lock.current = false
    }
  }
  const remove = async (id: string) => {
    if (lock.current) return
    lock.current = true
    setWorking(true)
    setError('')
    try {
      const result = await request(
        '/api/attachments/remove',
        {
          taskId: task.id,
          id,
        },
        attachmentMutationSchema,
      )
      setPending(result.revision)
    } catch (error) {
      setError(String(error))
    } finally {
      setWorking(false)
      lock.current = false
    }
  }
  return {
    upload,
    remove,
    error,
    files,
    previews,
    uploading,
    busy: working || (pending !== null && (!snapshot || snapshot.revision < pending)),
  }
}
