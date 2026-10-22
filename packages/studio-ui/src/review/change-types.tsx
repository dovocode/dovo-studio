import { pullFileKind, type FileKind } from '@dovo/protocol'
import { cn } from '../lib/utils'

const categories: { kind: FileKind; label: string; color: string }[] = [
  { kind: 'normal', label: 'Code', color: 'text-sky-700 dark:text-sky-400' },
  { kind: 'tests', label: 'Tests', color: 'text-emerald-700 dark:text-emerald-400' },
  { kind: 'mocks', label: 'Mocks', color: 'text-violet-600 dark:text-violet-400' },
  { kind: 'docs', label: 'Docs', color: 'text-amber-800 dark:text-amber-400' },
  { kind: 'generated', label: 'Generated', color: 'text-muted-foreground' },
]
export function ChangeTypeIndicator({ kind }: { kind: FileKind }) {
  const category = categories.find((category) => category.kind === kind)!
  return (
    <span
      role="img"
      aria-label={category.label}
      title={category.label}
      className={cn('size-2 shrink-0 rounded-full bg-current', category.color)}
    />
  )
}
export function ChangeTypeFilters({
  files,
  value,
  onChange,
  total,
}: {
  files: readonly (Parameters<typeof pullFileKind>[0] & { changeKind?: FileKind })[]
  value?: FileKind
  onChange: (kind: FileKind | undefined) => void
  total?: number | null
}) {
  const counts = new Map<FileKind, number>()
  for (const file of files) {
    const kind = file.changeKind ?? pullFileKind(file)
    counts.set(kind, (counts.get(kind) ?? 0) + 1)
  }
  return (
    <div
      aria-label="Change types"
      className="flex flex-wrap items-center gap-1 text-xs tabular-nums"
    >
      <button
        type="button"
        aria-pressed={!value}
        onClick={() => onChange(undefined)}
        className={cn(
          'rounded-md border px-2 py-1',
          !value ? 'bg-accent border-border' : 'border-transparent',
        )}
      >
        All {files.length}
      </button>
      {categories
        .filter(({ kind }) => counts.has(kind) || value === kind)
        .map(({ kind, label, color }) => (
          <button
            key={kind}
            type="button"
            aria-pressed={value === kind}
            onClick={() => onChange(value === kind ? undefined : kind)}
            className={cn(
              'flex items-center gap-1.5 rounded-md border px-2 py-1',
              color,
              value === kind ? 'bg-accent border-border' : 'border-transparent',
            )}
          >
            <span aria-hidden className="size-2 rounded-full bg-current" />
            {label} {counts.get(kind) ?? 0}
          </button>
        ))}
      {total != null && total > files.length && (
        <span className="text-muted-foreground">
          ({files.length} of {total} files loaded)
        </span>
      )}
    </div>
  )
}
