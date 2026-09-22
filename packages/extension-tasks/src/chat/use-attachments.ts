import { useEffect, useRef, useState } from 'react'
import {
  attachmentUploadResultSchema,
  attachmentMutationSchema,
  MAX_ATTACHMENT_BYTES,
  type Task,
} from '@dovo/studio-core'
import { useWorkspace } from '@dovo/studio-core'
export function useAttachments(task: Task) {
  const { request, snapshot, connected } = useWorkspace()
  const lock = useRef(false)
  const [working, setWorking] = useState(false),
    [error, setError] = useState(''),
    [pending, setPending] = useState<number | null>(null)
  const files =
    (snapshot?.workspace.tasks.find((t) => t.id === task.id) ?? task).draftAttachments ?? []
  useEffect(() => {
    if (!connected || (pending !== null && snapshot && snapshot.revision >= pending))
      setPending(null)
  }, [snapshot, connected, pending])
  const upload = async (files: File[]) => {
    if (lock.current) {
      setError('Wait for the current attachment operation to finish.')
      return
    }
    lock.current = true
    setWorking(true)
    setError('')
    try {
      for (const file of files) {
        if (file.size > MAX_ATTACHMENT_BYTES) throw new Error(`${file.name} is larger than 4 MB`)
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () =>
            typeof reader.result === 'string'
              ? resolve(reader.result.slice(reader.result.indexOf(',') + 1))
              : reject(new Error('Could not read file'))
          reader.onerror = () => reject(reader.error ?? new Error('Could not read file'))
          reader.readAsDataURL(file)
        })
        const { revision } = await request(
          '/api/attachments/upload',
          { taskId: task.id, id: crypto.randomUUID(), name: file.name, data },
          attachmentUploadResultSchema,
        )
        setPending(revision)
      }
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
        { taskId: task.id, id },
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
    busy: working || (pending !== null && (!snapshot || snapshot.revision < pending)),
  }
}
