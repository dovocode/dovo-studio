import { useState } from 'react'
import { responses, useWorkspace, updateTask, type Task, type ChangedFile } from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'
export function DiskActions({ task, file }: { task: Task; file: ChangedFile }) {
  const { connected, request, setWorkspace } = useWorkspace(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const apply = () => {
    setBusy(true)
    setError('')
    void request(
      '/api/scm/apply',
      {
        repositoryId: task.repositoryId,
        taskId: task.id,
        path: file.path,
        expected: file.diskContents ?? file.after,
        contents: file.after,
      },
      responses.ok,
    )
      .then(() =>
        setWorkspace((w) =>
          updateTask(w, task.id, (t) => ({
            ...t,
            files: t.files.map((f) => (f.path === file.path ? { ...f, diskContents: f.after } : f)),
          })),
        ),
      )
      .catch((error) => setError(String(error)))
      .finally(() => setBusy(false))
  }
  return (
    <div className="space-y-1 border-b px-3 py-2">
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-6 text-[10px]"
          disabled={!connected || task.example || busy || file.diskContents === file.after}
          onClick={apply}
        >
          Apply saved draft to disk
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 text-[10px]"
          disabled={!connected || task.example || busy}
          onClick={() => {
            setBusy(true)
            setError('')
            void request(
              '/api/scm/changes',
              { repositoryId: task.repositoryId, taskId: task.id },
              responses.files,
            )
              .catch((error) => setError(String(error)))
              .finally(() => setBusy(false))
          }}
        >
          Reload disk changes
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-[10px] text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
