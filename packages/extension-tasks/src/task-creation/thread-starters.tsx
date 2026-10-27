import { THREAD_STARTERS } from '@dovo/protocol'
import { CodeXml, ScanSearch, BookOpen, ListChecks } from 'lucide-react'

const icons = { build: CodeXml, fix: ScanSearch, understand: BookOpen, plan: ListChecks }

export function ThreadStarters({
  disabled,
  onChoose,
}: {
  disabled?: boolean
  onChoose: (prompt: string) => void
}) {
  return (
    <nav aria-label="Start with a prompt" className="mx-auto mt-4 w-full max-w-[var(--chat-max)]">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {THREAD_STARTERS.map(({ id, label, prompt }) => {
          const Icon = icons[id]
          return (
            <button
              key={id}
              type="button"
              disabled={disabled}
              onClick={() => onChoose(prompt)}
              className="flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-xl border border-border/60 px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
            >
              <Icon className="size-3.5 shrink-0" aria-hidden="true" />
              <span>{label}</span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
