import { useApplicationState } from '@dovo/studio-core/state'
import { DiskActions } from './disk-actions'
import { FileDiff, PanelRightClose, SearchCheck } from 'lucide-react'
import { REVIEW_PROMPT } from '@dovo/protocol'
import { ReviewFindings } from '../chat/thread/review-findings'
import { CommitBar } from './commit-bar'
import { useWorkspace, responses, updateTask, type Task } from '@dovo/studio-core'
import { Button, EmptyState, IconButton, ErrorBoundary } from '@dovo/studio-ui'
import { FileTree } from './file-tree'
import { PierreEditor } from './pierre-editor'
import { ReviewFeedback } from './review-feedback'
import { ReviewCommentsTray } from '../chat/thread/review-comments-tray'
export function ReviewPane({ task, onClose }: { task: Task; onClose?: () => void }) {
  const { setWorkspace, request, connected } = useWorkspace()
  const [reviewBusy, setReviewBusy] = useApplicationState(false)
  const [reviewError, setReviewError] = useApplicationState('')
  const [selected, setSelected] = useApplicationState(task.files[0]?.path ?? '')
  const file = task.files.find((f) => f.path === selected) ?? task.files[0]
  return (
    <aside className="flex h-full min-w-0 flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center justify-between border-b px-3">
        <span className="flex items-center gap-2 text-xs">
          <FileDiff size={14} />
          Changes <span className="text-muted-foreground">{task.files.length}</span>
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-7 gap-1 text-xs"
          title="The agent reviews its uncommitted changes and lists findings here"
          disabled={!connected || task.status === 'running' || !task.files.length || reviewBusy}
          onClick={() => {
            setReviewBusy(true)
            setReviewError('')
            void request(
              '/api/tasks/message',
              { id: task.id, messageId: crypto.randomUUID(), text: REVIEW_PROMPT, review: true },
              responses.ok,
            )
              .catch((cause: unknown) =>
                setReviewError(cause instanceof Error ? cause.message : String(cause)),
              )
              .finally(() => setReviewBusy(false))
          }}
        >
          <SearchCheck className="size-3.5" /> Review changes
        </Button>
        {onClose && (
          <IconButton label="Close review pane" className="size-7" onClick={onClose}>
            <PanelRightClose size={14} />
          </IconButton>
        )}
      </header>
      {reviewError && (
        <p role="alert" className="border-b px-3 py-2 text-xs text-destructive">
          {reviewError}
        </p>
      )}
      <ReviewCommentsTray task={task} className="p-2" />
      <ReviewFindings
        task={task}
        className="p-2"
        onOpen={(finding) => {
          if (task.files.some((item) => item.path === finding.path)) setSelected(finding.path)
        }}
      />
      <CommitBar task={task} />
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
                  {
                    id: task.id,
                    path: file.path,
                    body,
                    excerpt,
                    ...range,
                  },
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
