import { useApplicationState } from '@dovo/studio-core/state'
import { useWorkspace, updateTask, type Task, type ChangedFile } from '@dovo/studio-core'
import { Button, Checkbox, Textarea } from '@dovo/studio-ui'
export function ReviewFeedback({ task, file }: { task: Task; file: ChangedFile }) {
  const { setWorkspace } = useWorkspace()
  const [feedback, setFeedback] = useApplicationState('')
  return (
    <div className="shrink-0 space-y-2 border-t p-3">
      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-[0.6875rem]">
          <Checkbox
            checked={file.viewed}
            onCheckedChange={(checked) =>
              setWorkspace((w) =>
                updateTask(w, task.id, (t) => ({
                  ...t,
                  files: t.files.map((f) =>
                    f.path === file.path
                      ? {
                          ...f,
                          viewed: checked === true,
                        }
                      : f,
                  ),
                })),
              )
            }
          />
          Viewed
        </label>
        <span className="text-[0.625rem] text-muted-foreground">
          {task.files.filter((f) => f.viewed).length} / {task.files.length}
        </span>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          if (!feedback.trim()) return
          setWorkspace((w) =>
            updateTask(w, task.id, (t) => ({
              ...t,
              messages: [
                ...t.messages,
                {
                  id: crypto.randomUUID(),
                  role: 'user',
                  text: feedback.trim(),
                  file: file.path,
                },
              ],
            })),
          )
          setFeedback('')
        }}
      >
        <Textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          aria-label="File feedback"
          placeholder="Leave feedback on this file…"
          className="min-h-12 text-xs"
        />
        <Button
          type="submit"
          size="sm"
          variant="ghost"
          disabled={!feedback.trim()}
          className="mt-1 h-6 text-[0.625rem]"
        >
          Add feedback to chat
        </Button>
      </form>
    </div>
  )
}
