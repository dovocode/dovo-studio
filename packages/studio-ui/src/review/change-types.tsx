import { changeTypeDistribution, type ChangeTypeFile, type FileKind } from '@dovo/protocol'
import { cn } from '../lib/utils'

const categories: { kind: FileKind; label: string; color: string }[] = [
  { kind: 'normal', label: 'Code', color: 'text-sky-700 dark:text-sky-400' },
  { kind: 'tests', label: 'Tests', color: 'text-emerald-800 dark:text-emerald-400' },
  { kind: 'mocks', label: 'Mocks', color: 'text-violet-700 dark:text-violet-300' },
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
      className={cn('size-1.5 shrink-0 rounded-full bg-current', category.color)}
    />
  )
}
export function ChangeTypeFilters({
  files,
  value,
  onChange,
  total,
  weightBy = 'files',
}: {
  files: readonly ChangeTypeFile[]
  value?: FileKind
  onChange: (kind: FileKind | undefined) => void
  total?: number | null
  weightBy?: 'files' | 'lines'
}) {
  const { counts, weights, unit, total: amount } = changeTypeDistribution(files, weightBy)
  return (
    <div className="space-y-1">
      {!!files.length && (
        <div
          className="flex w-full gap-0.5"
          aria-label={unit === 'lines' ? 'Changed line distribution' : 'File type distribution'}
        >
          {categories
            .filter(({ kind }) => (weights.get(kind) ?? 0) > 0)
            .map(({ kind, label, color }) => (
              <button
                key={kind}
                type="button"
                aria-label={`Filter ${label}: ${counts.get(kind)} files${unit === 'lines' ? `, ${weights.get(kind)} of ${amount} changed lines` : ''}`}
                aria-pressed={value === kind}
                title={`${label}: ${weights.get(kind)} of ${amount} ${unit}${unit === 'lines' ? ` changed · ${counts.get(kind)} files` : ''}`}
                onClick={() => onChange(value === kind ? undefined : kind)}
                style={{ flexGrow: weights.get(kind), flexBasis: 0 }}
                className={cn(
                  'group py-2.5 focus-visible:outline-2 focus-visible:outline-ring',
                  unit === 'lines' ? 'min-w-2' : 'min-w-6',
                  color,
                )}
              >
                <span
                  className={cn(
                    'block h-1.5 rounded-full bg-current',
                    value && value !== kind && 'opacity-30',
                  )}
                />
              </button>
            ))}
        </div>
      )}
      <div
        aria-label="Change types"
        className="flex flex-wrap items-center gap-1 text-xs tabular-nums"
      >
        <button
          type="button"
          aria-pressed={!value}
          onClick={() => onChange(undefined)}
          className="studio-filter-chip"
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
              className={cn('studio-filter-chip flex items-center gap-1.5', color)}
            >
              <span aria-hidden className="size-1.5 rounded-full bg-current" />
              {label} {counts.get(kind) ?? 0}
            </button>
          ))}
        {total != null && total > files.length && (
          <span className="text-muted-foreground">
            ({files.length} of {total} files loaded)
          </span>
        )}
      </div>
    </div>
  )
}
