import { responses, type ChangedFile, type Task } from '@dovo/protocol'
import { useEffect, useState } from 'react'

export function useWorkingChangePreview(
  enabled: boolean,
  task: Pick<Task, 'id' | 'repositoryId'>,
  file: ChangedFile | undefined,
  request: (
    path: '/api/scm/changes',
    input: { repositoryId: string; taskId: string; includeFiles: false; previewPath: string },
    schema: typeof responses.changesRefresh,
  ) => Promise<unknown>,
) {
  const path = enabled && file?.preview?.kind === 'deferred' ? file.path : undefined
  const revision = path ? file?.workingRevision : undefined
  const { id, repositoryId } = task
  const key = JSON.stringify([id, repositoryId, path, revision])
  const [result, setResult] = useState<{ key: string; request: typeof request; error?: string }>()
  useEffect(() => {
    if (!path) return
    let active = true
    void request(
      '/api/scm/changes',
      { repositoryId, taskId: id, includeFiles: false, previewPath: path },
      responses.changesRefresh,
    ).then(
      () => {
        if (active) setResult({ key, request })
      },
      (cause: unknown) => {
        if (active)
          setResult({ key, request, error: cause instanceof Error ? cause.message : String(cause) })
      },
    )
    return () => {
      active = false
    }
  }, [id, repositoryId, path, key, request])
  const current = result?.key === key && result.request === request ? result : undefined
  return { loading: !!path && !current, error: path ? current?.error : undefined }
}
