import { useImageEditor } from './image-editor'
import { createRuntimeClient, randomUUID, mutableStruct } from '@dovo/protocol'
import { draftAttachments, type LocalAttachment } from './draft-attachments'
import { optimizeAttachmentImage } from './attachment-images'
import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect, useRef, useState } from 'react'
import {
  attachmentUploadResultSchema,
  attachmentPreparedSchema,
  attachmentReadSchema,
  attachmentMutationSchema,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  type Task,
  type Attachment,
} from '@dovo/studio-core'
import { Schema } from 'effect'
import { useWorkspace } from '@dovo/studio-core'
export function useAttachments(
  task: Pick<Task, 'id' | 'draftAttachments'>,
  editing?: {
    messageId: string
    files: Attachment[]
    uploaded: (file: Attachment, replaceId?: string) => void
    remove: (id: string) => void
  },
  detached?: {
    key: string
    files: Attachment[]
    count?: number
    uploaded: (file: Attachment) => boolean
    remove: (id: string) => void
  },
  flushDraft?: () => void,
) {
  const { request, snapshot, connected, connection } = useWorkspace()
  const scope = JSON.stringify([
    connection?.address,
    connection?.token,
    connection?.runtimeId,
    task.id,
    editing?.messageId,
    detached?.key,
  ])
  const currentScope = useRef(scope)
  currentScope.current = scope
  const activeUploads = useRef<{
    scope: string
    pending: boolean
    done: Promise<string | undefined>
  } | null>(null)
  const recoverableFiles = useRef(new Map<string, { file: File; owner: string }>())
  const failedUploads = useRef(new Map<string, { file: File; replaceId?: string }>())
  const [, setFailedVersion] = useState(0)
  useEffect(() => {
    failedUploads.current.clear()
    for (const [id, source] of recoverableFiles.current)
      if (source.owner !== scope) recoverableFiles.current.delete(id)
    setFailedVersion((value) => value + 1)
  }, [scope])
  const imageEditor = useImageEditor()
  const lock = useRef(false)
  const urls = useRef(new Set<string>())
  const [uploads, setUploads] = useState<(LocalAttachment & { scope?: string; owner: string })[]>(
    [],
  )
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
  useEffect(() => {
    currentScope.current = scope
    return () => {
      if (currentScope.current === scope) currentScope.current = 'unmounted'
    }
  }, [scope])
  const savedFiles = detached
    ? detached.files
    : editing
      ? editing.files
      : ((snapshot?.workspace.tasks.find((t) => t.id === task.id) ?? task).draftAttachments ?? [])
  useEffect(() => {
    if (!connected || (pending !== null && snapshot && snapshot.revision >= pending))
      setPending(null)
  }, [snapshot, connected, pending])
  const files = detached
    ? detached.files
    : editing
      ? editing.files
      : draftAttachments(
          savedFiles,
          uploads.filter((item) => item.owner === scope && item.scope === undefined),
          snapshot?.revision,
        )
  const previews = new Map(
    uploads
      .filter((item) => item.owner === scope)
      .flatMap((item) => (item.url ? [[item.attachment.id, item.url] as const] : [])),
  )
  const uploading = uploads.filter((item) => item.owner === scope && item.revision === undefined)
  useEffect(() => {
    if (!snapshot) return
    const removed = uploads.filter(
      (item) =>
        item.revision !== undefined &&
        snapshot.revision >= item.revision &&
        !savedFiles.some((file) => file.id === item.attachment.id),
    )
    if (!removed.length) return
    for (const item of removed) {
      recoverableFiles.current.delete(item.attachment.id)
      if (item.url) {
        URL.revokeObjectURL(item.url)
        urls.current.delete(item.url)
      }
    }
    setUploads((current) =>
      current.filter((item) => !removed.some((old) => old.attachment.id === item.attachment.id)),
    )
  }, [snapshot, uploads, savedFiles])
  const upload = async (
    selected: File[],
    replaceId?: string,
    editChatImage = false,
    signal?: AbortSignal,
    retryId?: string,
  ) => {
    if (lock.current) {
      setError('Wait for the current attachment operation to finish.')
      if (signal) throw new Error('Wait for the current attachment operation to finish.')
      return
    }
    lock.current = true
    setWorking(true)
    setError('')
    const failures: string[] = []
    let complete: (failure?: string) => void = () => {}
    const done = new Promise<string | undefined>((resolve) => {
      complete = resolve
    })
    const operation = { scope, pending: true, done }
    activeUploads.current = operation
    try {
      // Capture the destination before image editing or file reads yield. Another window or
      // device can send this draft even while this composer's Send control is disabled.
      let draftGuard: string | undefined
      if (!editing && !detached) {
        // Queue local text before the request flushes workspace writes and captures the guard.
        flushDraft?.()
        const destination = await request(
          '/api/attachments/draft-guard',
          { taskId: task.id },
          mutableStruct({
            guard: Schema.String,
            guardedUploads: Schema.optional(Schema.Literal(1)),
          }),
        )
        if (destination.guardedUploads !== 1)
          throw new Error('Update this computer before attaching files safely.')
        draftGuard = destination.guard
      }
      if (replaceId && !retryId) {
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
        if (
          (detached?.count ?? files.length) - (replaceId ? 1 : 0) + accepted.length >=
          MAX_ATTACHMENTS
        ) {
          rejected.push(`${original.name}: attach up to 5 files per message.`)
          continue
        }
        let file: File
        try {
          const prepared = retryId ? original : await optimizeAttachmentImage(original)
          const edited = retryId ? prepared : await imageEditor.edit(prepared, editChatImage)
          if (!edited || (replaceId && !retryId && edited === prepared)) continue
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
      if (signal?.aborted) throw new Error('Attachment cancelled.')
      if (signal && rejected.length) throw new Error(rejected.join('\n'))
      const batch = accepted.map((file) => {
        const attachment = {
          id: retryId ?? randomUUID(),
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
          owner: scope,
          url,
          replaces: replaceId,
          scope: detached?.key ?? editing?.messageId,
        })),
      ])
      const uploadFile = async ({ file, attachment, url }: (typeof batch)[number]) => {
        let dispatched = false
        let cancellation: Promise<void> | undefined
        let interrupt: ((cause: Error) => void) | undefined
        const cancel = () => {
          if (!dispatched) return Promise.resolve()
          return (cancellation ??= (async () => {
            // Cleanup belongs to the computer/task that accepted this upload, even if
            // the composer has switched computers or its dialog has already unmounted.
            if (!connection) throw new Error('The original computer connection is unavailable.')
            const result = await createRuntimeClient(connection).request(
              '/api/attachments/remove',
              { taskId: task.id, id: attachment.id },
              attachmentMutationSchema,
              { method: 'POST' },
            )
            if (currentScope.current === scope) setPending(result.revision)
          })())
        }
        const cancellationError = (cause: unknown) =>
          new Error(
            `Could not cancel ${file.name} on its original computer. It may still be attached there. ${cause instanceof Error ? cause.message : String(cause)}`,
            { cause },
          )
        const abort = () => {
          void cancel().then(
            () => interrupt?.(new Error('Attachment cancelled.')),
            (cause) => {
              const failure = cancellationError(cause)
              setError(failure.message)
              interrupt?.(failure)
            },
          )
        }
        signal?.addEventListener('abort', abort, { once: true })
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
          if (signal?.aborted) throw new Error('Attachment cancelled.')
          const interrupted = signal
            ? new Promise<never>((_resolve, reject) => {
                interrupt = reject
              })
            : undefined
          dispatched = true
          const uploading = request(
            replaceId ? '/api/attachments/replace' : '/api/attachments/upload',
            {
              taskId: task.id,
              queuedMessageId: editing?.messageId,
              detached: detached ? true : undefined,
              draftGuard,
              id: attachment.id,
              name: file.name,
              data,
              ...(replaceId ? { replaceId } : {}),
            },
            attachmentUploadResultSchema,
          )
          // A cancelled dialog need not wait for a delayed/lost upload response once
          // the runtime has durably rejected that upload ID. Observe both outcomes.
          const result = await (interrupted ? Promise.race([uploading, interrupted]) : uploading)
          if (draftGuard !== undefined) {
            if (!result.nextGuard)
              throw new Error('Update this computer before attaching files safely.')
            draftGuard = result.nextGuard
          }
          if (signal?.aborted) {
            await cancel()
            throw new Error('Attachment cancelled.')
          }
          if (
            detached &&
            (currentScope.current !== scope || !detached.uploaded(result.attachment))
          ) {
            await cancel()
            throw new Error('The question changed before the file was attached.')
          }
          if (retryId && currentScope.current === scope) {
            failedUploads.current.delete(retryId)
            setFailedVersion((value) => value + 1)
          }
          recoverableFiles.current.set(attachment.id, { file, owner: scope })
          editing?.uploaded(result.attachment, replaceId)
          setUploads((current) =>
            current.map((item) =>
              item.attachment.id === attachment.id
                ? { ...item, attachment: result.attachment, revision: result.revision }
                : item,
            ),
          )
        } catch (error) {
          let failure = error
          if (signal?.aborted)
            try {
              await cancel()
            } catch (cause) {
              const cleanupFailure = cancellationError(cause)
              failure = cleanupFailure
              setError(cleanupFailure.message)
            }
          failures.push(`${file.name}: ${String(failure)}`)
          if (!editing && !detached && !signal?.aborted && currentScope.current === scope) {
            failedUploads.current.set(attachment.id, { file, replaceId })
            setFailedVersion((value) => value + 1)
          }
          setUploads((current) => current.filter((item) => item.attachment.id !== attachment.id))
          if (url) {
            URL.revokeObjectURL(url)
            urls.current.delete(url)
          }
          if (!signal?.aborted)
            setError((current) =>
              [current, `${file.name}: ${String(failure)}`].filter(Boolean).join('\n'),
            )
          if (signal) throw failure
        } finally {
          signal?.removeEventListener('abort', abort)
        }
      }
      // Each direct upload returns the next guard from its commit transaction. Chain the
      // batch so our own additions are accepted without accepting a different draft.
      let previous = Promise.resolve()
      await Promise.all(
        batch.map((item) => {
          const pending =
            draftGuard === undefined ? uploadFile(item) : previous.then(() => uploadFile(item))
          previous = pending.catch(() => undefined)
          return pending
        }),
      )
    } catch (error) {
      failures.push(String(error))
      if (!signal?.aborted) setError(String(error))
      if (signal) throw error
    } finally {
      operation.pending = false
      complete(failures.length ? failures.join('\n') : undefined)
      setWorking(false)
      lock.current = false
    }
  }
  const prepare = async (selected: Attachment[] = files) => {
    if (!selected.length || snapshot?.attachmentPreparationSupported !== true) return
    const ids = selected.map((file) => file.id)
    const result = await request(
      '/api/attachments/prepare',
      { taskId: task.id, ids },
      attachmentPreparedSchema,
    )
    if (currentScope.current !== scope)
      throw new Error('The conversation changed before attachments finished.')
    for (const id of result.missing) {
      if (currentScope.current !== scope)
        throw new Error('The conversation changed before attachments finished.')
      const source = recoverableFiles.current.get(id)
      if (!source || source.owner !== scope)
        throw new Error('This attachment expired. Choose the file again. Your draft is unchanged.')
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () =>
          typeof reader.result === 'string'
            ? resolve(reader.result.slice(reader.result.indexOf(',') + 1))
            : reject(new Error('Could not read file'))
        reader.onerror = () => reject(reader.error ?? new Error('Could not read file'))
        reader.readAsDataURL(source.file)
      })
      if (currentScope.current !== scope)
        throw new Error('The conversation changed before attachments finished.')
      // Restore bytes only. Never attach to the live draft during recovery.
      await request(
        '/api/attachments/upload',
        {
          taskId: task.id,
          queuedMessageId: editing?.messageId,
          detached: true,
          id,
          name: source.file.name,
          data,
        },
        attachmentUploadResultSchema,
      )
    }
    if (currentScope.current !== scope)
      throw new Error('The conversation changed before attachments finished.')
  }
  const remove = async (id: string) => {
    if (detached) {
      if (lock.current) return
      lock.current = true
      setWorking(true)
      setError('')
      try {
        await request('/api/attachments/remove', { taskId: task.id, id }, attachmentMutationSchema)
        if (currentScope.current === scope) detached.remove(id)
      } catch (error) {
        setError(String(error))
      } finally {
        lock.current = false
        setWorking(false)
      }
      return
    }
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
    prepare,
    submissionFiles: [
      ...new Map(
        [
          ...uploading
            .filter((item) => !item.replaces && !item.scope)
            .map((item) => item.attachment),
          ...files,
        ].map((file) => [file.id, file]),
      ).values(),
    ],
    canSubmitWhileUploading:
      !editing &&
      !detached &&
      uploading.length > 0 &&
      uploading.every((item) => !item.replaces && !item.scope),
    waitForUploads: async () => {
      const operation = activeUploads.current
      if (operation?.scope === scope && operation.pending) {
        const failure = await operation.done
        if (failure) throw new Error(failure)
      }
      if (currentScope.current !== scope)
        throw new Error('The conversation changed before attachments finished.')
      if (failedUploads.current.size)
        throw new Error('Retry or remove failed attachments before sending.')
      await prepare()
    },
    failedUploads: [...failedUploads.current.entries()].map(([id, { file }]) => ({
      id,
      name: file.name,
    })),
    retryUpload: (id: string) => {
      const failed = failedUploads.current.get(id)
      if (!failed || lock.current) return
      const { file, replaceId } = failed
      if (savedFiles.some((saved) => saved.id === id)) {
        recoverableFiles.current.set(id, { file, owner: scope })
        failedUploads.current.delete(id)
        setFailedVersion((value) => value + 1)
        setError('')
        return
      }
      void upload([file], replaceId, false, undefined, id)
    },
    discardFailedUpload: (id: string) => {
      failedUploads.current.delete(id)
      setFailedVersion((value) => value + 1)
      setError('')
    },
    edit: (id: string) => upload([], id),
    editor: imageEditor.editor,
    upload,
    uploadContext: (files: File[], signal: AbortSignal) => upload(files, undefined, false, signal),
    remove,
    error,
    files,
    previews,
    uploading,
    busy: working || (pending !== null && (!snapshot || snapshot.revision < pending)),
  }
}
