import {
  changeTypeDistribution,
  pullFileKind,
  type ChangeTypeFile,
  type FileKind,
} from '@dovo/protocol'
import { ChevronDown, FileText } from 'lucide-react'
import { useId, useMemo, type ReactNode } from 'react'
import { cn } from '../lib/utils'
import { ChangeCategoryIcon, changeCategories, ChangeTypeFilters } from './change-types'

const lineCount = (value: number | null | undefined) =>
  value != null && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0

/** The same overview for saved turns and PRs; the caller keeps ownership of file navigation. */
export function ChangeSummary({
  files,
  expanded,
  onExpandedChange,
  value,
  onChange,
  total,
  title,
  children,
  actions,
}: {
  files: readonly ChangeTypeFile[]
  expanded: boolean
  onExpandedChange: (expanded: boolean) => void
  value?: FileKind
  onChange: (kind: FileKind | undefined) => void
  total?: number | null
  title?: string
  children?: ReactNode
  actions?: ReactNode
}) {
  const bodyId = useId()
  const { counts, weights, unit } = useMemo(() => changeTypeDistribution(files, 'lines'), [files])
  const stats = useMemo(() => {
    const totals = new Map<FileKind, { additions: number | null; deletions: number | null }>()
    for (const file of files) {
      const kind = file.changeKind ?? pullFileKind(file)
      const previous = totals.get(kind) ?? { additions: null, deletions: null }
      totals.set(kind, {
        additions:
          file.additions == null
            ? previous.additions
            : (previous.additions ?? 0) + lineCount(file.additions),
        deletions:
          file.deletions == null
            ? previous.deletions
            : (previous.deletions ?? 0) + lineCount(file.deletions),
      })
    }
    return totals
  }, [files])
  const totals = [...stats.values()].reduce<{ additions: number | null; deletions: number | null }>(
    (sum, stat) => ({
      additions: stat.additions === null ? sum.additions : (sum.additions ?? 0) + stat.additions,
      deletions: stat.deletions === null ? sum.deletions : (sum.deletions ?? 0) + stat.deletions,
    }),
    { additions: null, deletions: null },
  )
  const categories = changeCategories.filter(({ kind }) => counts.has(kind))
  const knownLines = files.some((file) => file.additions != null || file.deletions != null)
  const partialStats =
    files.some((file) => file.additions == null || file.deletions == null) ||
    (total != null && total > files.length)
  const count = total ?? files.length
  const label = title ?? `${count} ${count === 1 ? 'file' : 'files'} changed`
  const amounts = (additions: number | null, deletions: number | null) => (
    <span className="inline-flex items-center gap-2 text-xs tabular-nums">
      {additions !== null && (
        <span className="text-status-success">+{additions.toLocaleString()}</span>
      )}
      {deletions !== null && (
        <span className="text-status-error">−{deletions.toLocaleString()}</span>
      )}
    </span>
  )
  const distribution = (
    <span
      role="img"
      aria-label={`${unit === 'lines' ? `${partialStats ? 'Available changed' : 'Changed'} line` : 'File type'} distribution: ${categories.map(({ kind, label }) => `${label} ${weights.get(kind) ?? 0} ${unit}`).join(', ')}`}
      className="flex h-2 w-full gap-px overflow-hidden rounded-full bg-muted"
    >
      {categories
        .filter(({ kind }) => (weights.get(kind) ?? 0) > 0)
        .map(({ kind, color }) => (
          <span
            key={kind}
            className={cn('min-w-1 bg-current', color)}
            style={{ flexGrow: weights.get(kind), flexBasis: 0 }}
          />
        ))}
    </span>
  )
  return (
    <section
      aria-label="Changed file summary"
      className="studio-change-summary"
      data-expanded={expanded}
    >
      <button
        type="button"
        aria-label={label}
        aria-description={
          knownLines
            ? `${totals.additions ?? 'Unknown'} additions, ${totals.deletions ?? 'unknown'} deletions${partialStats ? ', available line counts' : ''}`
            : undefined
        }
        aria-expanded={expanded}
        aria-controls={bodyId}
        onClick={() => onExpandedChange(!expanded)}
        className="studio-change-summary-toggle"
      >
        <span aria-hidden className="studio-change-summary-icon">
          <FileText className="size-5" />
        </span>
        <span className="min-w-0 text-left">
          <span className="block text-sm font-medium break-words text-foreground">{label}</span>
          {knownLines && amounts(totals.additions, totals.deletions)}
          {knownLines && partialStats && (
            <span className="ml-2 text-[0.625rem] text-muted-foreground">available stats</span>
          )}
          {total != null && total > files.length && (
            <span className="block text-[0.625rem] text-muted-foreground">
              {files.length} of {total} files loaded
            </span>
          )}
        </span>
        {!expanded && !!files.length && (
          <span className="studio-change-summary-compact">
            {distribution}
            <span className="flex flex-wrap gap-1.5">
              {categories.map(({ kind, label, color }) => (
                <span
                  key={kind}
                  title={label}
                  data-selected={value === kind}
                  aria-label={`${label} ${counts.get(kind)}`}
                  className={cn('studio-change-category-chip', color)}
                >
                  <ChangeCategoryIcon kind={kind} />
                  <span className="text-foreground">{counts.get(kind)}</span>
                </span>
              ))}
            </span>
          </span>
        )}
        <ChevronDown
          aria-hidden
          className={cn(
            'size-4 shrink-0 self-center text-muted-foreground transition-transform',
            expanded && 'rotate-180',
          )}
        />
      </button>
      {expanded && (
        <div id={bodyId}>
          {!!files.length && (
            <div className="space-y-3 px-3 pb-3" aria-label="Changed file breakdown">
              {distribution}
              <div className="studio-change-category-grid">
                {categories.map(({ kind, label, color }) => {
                  const stat = stats.get(kind)!
                  return (
                    <button
                      key={kind}
                      type="button"
                      aria-label={`Filter ${label}: ${counts.get(kind)} files`}
                      aria-description={
                        stat.additions !== null || stat.deletions !== null
                          ? `${stat.additions ?? 'Unknown'} additions, ${stat.deletions ?? 'unknown'} deletions${partialStats ? ', available line counts' : ''}`
                          : 'Line counts unavailable'
                      }
                      aria-pressed={value === kind}
                      onClick={() => onChange(value === kind ? undefined : kind)}
                      className={cn('studio-change-category-card', color)}
                    >
                      <span className="studio-change-category-symbol">
                        <ChangeCategoryIcon kind={kind} />
                      </span>
                      <span className="min-w-0 text-left text-xs text-foreground">
                        <span className="block truncate">{label}</span>
                        <span className="text-muted-foreground tabular-nums">
                          {counts.get(kind)}
                        </span>
                      </span>
                      {(stat.additions !== null || stat.deletions !== null) && (
                        <span className="col-span-2 justify-self-end">
                          {amounts(stat.additions, stat.deletions)}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
              <ChangeTypeFilters
                files={files}
                value={value}
                onChange={onChange}
                showDistribution={false}
              />
            </div>
          )}
          {children}
          {actions && (
            <div className="flex justify-end border-t border-border/50 px-2 py-1">{actions}</div>
          )}
        </div>
      )}
    </section>
  )
}
