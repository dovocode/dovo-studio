import { Button } from '@dovo/studio-ui'
import type { Task, CodeFinding } from '@dovo/protocol'
import { useTaskReview } from './use-task-review'
export function CodeReviewCard({
  task,
  onOpen,
  visible = true,
}: {
  task: Task
  onOpen: (finding?: CodeFinding) => void
  visible?: boolean
}) {
  const { report, error } = useTaskReview(task.id, task.status, visible && !task.example)
  const latest = report?.reviews[0]
  if (!latest) return null
  const findings = latest.findings.filter(
    (finding) => finding.status === 'open' || finding.status === 'addressed',
  )
  return (
    <section
      aria-label="Independent code review"
      className="mx-5 mb-3 space-y-2 rounded-lg border bg-card p-3 text-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <strong>Independent review · {latest.status}</strong>
        <Button size="sm" variant="outline" onClick={() => onOpen()}>
          Open review
        </Button>
      </div>
      <p className="text-muted-foreground">
        {latest.reviewer} · {findings.length} open {findings.length === 1 ? 'finding' : 'findings'}
        {report?.current ? '' : ' · changes since review'}
        {report?.approved ? ' · approved for push' : ''}
      </p>
      {findings.slice(0, 3).map((finding) => (
        <button
          key={finding.id}
          className="block text-left text-primary underline"
          onClick={() => onOpen(finding)}
        >
          {finding.severity.toUpperCase()} · {finding.path}:{finding.line} — {finding.title}
        </button>
      ))}
      {(latest.error || error) && (
        <p role="alert" className="text-destructive">
          {latest.error || error}
        </p>
      )}
    </section>
  )
}
