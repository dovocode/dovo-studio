import {
  Archive,
  AlarmClock,
  CloudOff,
  CircleX,
  CircleStop,
  FilePenLine,
  MessageCircleQuestion,
  Save,
  type LucideIcon,
  CircleCheck,
  CircleDashed,
  Pause,
} from 'lucide-react'
const statusIcons: Record<string, LucideIcon> = {
  Offline: CloudOff,
  Draft: FilePenLine,
  Paused: Pause,
  Working: CircleDashed,
  Done: CircleCheck,
  Finished: CircleCheck,
  Failed: CircleX,
  Stopped: CircleStop,
  Snoozed: AlarmClock,
  Waiting: AlarmClock,
  Settled: CircleCheck,
  Archived: Archive,
  'Needs input': MessageCircleQuestion,
  'Saving changes': Save,
}
export function ThreadRowStatus({
  state,
  label,
  age,
  tone,
}: {
  state: string
  label: string
  age: string
  tone: 'neutral' | 'active' | 'attention' | 'success' | 'danger'
}) {
  const Icon = statusIcons[state] ?? CircleDashed
  return (
    <span
      className="studio-thread-status inline-flex shrink-0 items-center gap-1 text-[0.6875rem] font-normal"
      data-thread-copy=""
      data-tone={tone}
      data-thread-state={state}
      aria-label={label}
      title={label}
    >
      {age && <span className="tabular-nums">{age}</span>}
      <Icon className="studio-thread-status-icon size-3 shrink-0" aria-hidden="true" />
    </span>
  )
}
