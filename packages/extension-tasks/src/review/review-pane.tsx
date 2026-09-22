import { DiskActions } from './disk-actions'
import { useState } from 'react'
import { FileDiff, PanelRightClose } from 'lucide-react'
import { useWorkspace, responses, updateTask, type Task } from '@dovo/studio-core'
import { EmptyState, IconButton, ErrorBoundary } from '@dovo/studio-ui'
import { FileTree } from './file-tree'
import { PierreEditor } from './pierre-editor'
import { ReviewFeedback } from './review-feedback'
export function ReviewPane({ task, onClose }: { task: Task; onClose?: () => void }) {
  const { setWorkspace, request } = useWorkspace()
  const [selected, setSelected] = useState(task.files[0]?.path ?? '')
  const file = task.files.find((f) => f.path === selected) ?? task.files[0]
  return (
    <aside className="flex h-full min-w-0 flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center justify-between border-b px-3">
        <span className="flex items-center gap-2 text-xs">
          <FileDiff size={14} />
          Changes <span className="text-muted-foreground">{task.files.length}</span>
        </span>
        {onClose && (
          <IconButton label="Close review pane" className="size-7" onClick={onClose}>
            <PanelRightClose size={14} />
          </IconButton>
        )}
      </header>
      {file ? (
        <>
          <DiskActions task={task} file={file} />
          <FileTree files={task.files} selected={file.path} onSelect={setSelected} />
          <ErrorBoundary key={task.id + file.path}>
            <PierreEditor
              key={task.id + file.path}
              taskId={task.id}
              comments={task.messages}
              onComment={async (body, range) => {
                const excerpt = (range.side === 'additions' ? file.after : file.before)
                  .split('\n')
                  .slice(range.start - 1, range.end)
                  .join('\n')
                await request(
                  '/api/tasks/feedback',
                  { id: task.id, path: file.path, body, excerpt, ...range },
                  responses.ok,
                )
              }}
              file={file}
              onSave={(after) =>
                setWorkspace((w) =>
                  updateTask(w, task.id, (t) => ({
                    ...t,
                    files: t.files.map((f) =>
                      f.path === file.path
                        ? {
                            ...f,
                            diskContents: f.diskContents ?? f.after,
                            after,
                            viewed: f.after === after && f.viewed,
                          }
                        : f,
                    ),
                  })),
                )
              }
            />
          </ErrorBoundary>
          <ReviewFeedback key={file.path} task={task} file={file} />
        </>
      ) : (
        <EmptyState
          icon={<FileDiff />}
          title="No changed files"
          description="Changes will appear here when a connected agent produces them."
        />
      )}
    </aside>
  )
}
