import { pullCommentSignal, type PullComment } from '@dovo/studio-core'
import {
  CircleCheck,
  CircleAlert,
  Clock3,
  Code2,
  MessageSquare,
  MessageSquareText,
  CircleSlash,
} from 'lucide-react'

export function ReviewBadge({ comment }: { comment: PullComment }) {
  const signal = pullCommentSignal(comment)
  const Icon =
    comment.kind === 'inline'
      ? Code2
      : comment.kind === 'comment'
        ? MessageSquare
        : comment.state === 'APPROVED'
          ? CircleCheck
          : comment.state === 'CHANGES_REQUESTED'
            ? CircleAlert
            : comment.state === 'DISMISSED'
              ? CircleSlash
              : comment.state === 'PENDING'
                ? Clock3
                : MessageSquareText
  const color =
    signal.tone === 'positive'
      ? 'border-emerald-400/20 bg-emerald-400/10 text-emerald-700 dark:text-emerald-300'
      : signal.tone === 'danger'
        ? 'border-red-400/20 bg-red-400/10 text-red-700 dark:text-red-300'
        : signal.tone === 'warning'
          ? 'border-amber-400/20 bg-amber-400/10 text-amber-700 dark:text-amber-300'
          : 'border-border bg-muted text-muted-foreground'
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1.5 rounded-md border px-2 py-1 text-[0.6875rem] font-medium leading-snug ${color}`}
    >
      <Icon aria-hidden className="size-3.5 shrink-0" />
      {signal.label}
    </span>
  )
}
