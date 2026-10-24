import { useImageEditor } from './image-editor'
import { randomUUID } from '@dovo/protocol'
import { draftAttachments, type LocalAttachment } from './draft-attachments'
import { optimizeAttachmentImage } from './attachment-images'
import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect, useRef, useState } from 'react'
import {
  attachmentUploadResultSchema,
  attachmentReadSchema,
  attachmentMutationSchema,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  type Task,
  type Attachment,
} from '@dovo/studio-core'
import { useWorkspace } from '@dovo/studio-core'
export function useAttachments(
  task: Pick<Task, 'id' | 'draftAttachments'>,
  editing?: {
    messageId: string
    files: Attachment[]
    uploaded: (file: Attachment, replaceId?: string) => void
    remove: (id: string) => void
  },
) {
  const { request, snapshot, connected } = useWorkspace()
  const imageEditor = useImageEditor()
  const lock = useRef(false)
  const urls = useRef(new Set<string>())
  const [uploads, setUploads] = useState<(LocalAttachment & { scope?: string })[]>([])
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
  const savedFiles = editing
    ? editing.files
    : ((snapshot?.workspace.tasks.find((t) => t.id === task.id) ?? task).draftAttachments ?? [])
  useEffect(() => {
    if (!connected || (pending !== null && snapshot && snapshot.revision >= pending))
      setPending(null)
  }, [snapshot, connected, pending])
  const files = editing
    ? editing.files
    : draftAttachments(
        savedFiles,
        uploads.filter((item) => item.scope === undefined),
        snapshot?.revision,
      )
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
  const upload = async (selected: File[], replaceId?: string, editChatImage = false) => {
    if (lock.current) {
      setError('Wait for the current attachment operation to finish.')
      return
    }
    lock.current = true
    setWorking(true)
    setError('')
    try {
      if (replaceId) {
        const previous = await request(
          '/api/attachments/read',
          { taskId: task.id, id: replaceId },
          attachmentReadSchema,
        )
        selected = [
          new File(
            [Uint8Array.from(atob(previous.data), (char) => char.charCodeAt(0))],
            previous.attachment.name,
            { type: previous.attachment.mime },
          ),
        ]
      }
      const accepted: File[] = []
      const rejected: string[] = []
      for (const original of selected) {
        if (files.length - (replaceId ? 1 : 0) + accepted.length >= MAX_ATTACHMENTS) {
          rejected.push(`${original.name}: attach up to 5 files per message.`)
          continue
        }
        let file: File
        try {
          const prepared = await optimizeAttachmentImage(original)
          const edited = await imageEditor.edit(prepared, editChatImage)
          if (!edited || (replaceId && edited === prepared)) continue
          file = edited === prepared ? prepared : await optimizeAttachmentImage(edited)
        } catch (cause) {
          rejected.push(
            `${original.name}: ${cause instanceof Error ? cause.message : String(cause)}`,
          )
          continue
        }
        if (file.size > MAX_ATTACHMENT_BYTES)
          rejected.push(`${file.name}: must be 5 MB or smaller.`)
        else accepted.push(file)
      }
      setError(rejected.join('\n'))
      const batch = accepted.map((file) => {
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
        ...batch.map(({ attachment, url }) => ({
          attachment,
          url,
          replaces: replaceId,
          scope: editing?.messageId,
        })),
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
              replaceId ? '/api/attachments/replace' : '/api/attachments/upload',
              {
                taskId: task.id,
                queuedMessageId: editing?.messageId,
                id: attachment.id,
                name: file.name,
                data,
                ...(replaceId ? { replaceId } : {}),
              },
              attachmentUploadResultSchema,
            )
            editing?.uploaded(result.attachment, replaceId)
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
    if (editing) {
      editing.remove(id)
      return
    }
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
    edit: (id: string) => upload([], id),
    editor: imageEditor.editor,
    upload,
    remove,
    error,
    files,
    previews,
    uploading,
    busy: working || (pending !== null && (!snapshot || snapshot.revision < pending)),
  }
}
