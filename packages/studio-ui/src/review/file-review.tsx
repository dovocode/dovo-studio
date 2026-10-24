import { useDeferredValue, useMemo, useState } from 'react'
import { pullFileKind, type FileKind, type ReviewGroup, type FileTreeEntry } from '@dovo/protocol'
import { ChevronRight, Layers } from 'lucide-react'
import { ChangeTypeFilters } from './change-types'
import { FileBrowserTree } from '../file-tree'
import { Button } from '../components/ui/button'
import { SearchField } from '../search-field'
import { Checkbox } from '../components/ui/checkbox'
export type ReviewListFile = FileTreeEntry & { viewed: boolean }
export function FileReviewControls({
  files,
  selected,
  onSelect,
  onViewed,
  disabled = false,
  busy = false,
  navigationDisabled = false,
  error = '',
  onRetry,
}: {
  files: ReviewListFile[]
  selected: string
  onSelect: (path: string) => void
  onViewed: (viewed: boolean) => void
  disabled?: boolean
  busy?: boolean
  navigationDisabled?: boolean
  error?: string
  onRetry: () => void
}) {
  const index = files.findIndex((file) => file.path === selected)
  const file = files[index]
  const nextUnviewed = [...files.slice(index + 1), ...files.slice(0, index)].find(
    (file) => !file.viewed,
  )
  return (
    <div className="shrink-0 border-b px-3 py-1.5">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="min-w-0 flex-1 truncate font-mono" title={file?.path}>
          {file?.path ?? 'Changed files'}
        </span>
        <span className="text-muted-foreground tabular-nums">
          {files.filter((file) => file.viewed).length}/{files.length} viewed
        </span>
        <label aria-busy={busy} className="flex min-h-8 items-center gap-2">
          <Checkbox
            aria-label="File viewed"
            checked={file?.viewed ?? false}
            disabled={disabled || busy || !file}
            onCheckedChange={(checked) => onViewed(checked === true)}
          />
          <span className="inline-grid">
            <span aria-hidden className="invisible col-start-1 row-start-1">
              Saving…
            </span>
            <span role="status" className="col-start-1 row-start-1">
              {busy ? 'Saving…' : 'Viewed'}
            </span>
          </span>
        </label>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Previous file"
          disabled={navigationDisabled || index <= 0}
          onClick={() => {
            const previous = files[index - 1]
            if (previous) onSelect(previous.path)
          }}
        >
          ←
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Next file"
          disabled={navigationDisabled || index < 0 || index >= files.length - 1}
          onClick={() => {
            const next = files[index + 1]
            if (next) onSelect(next.path)
          }}
        >
          →
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={navigationDisabled || !nextUnviewed}
          onClick={() => {
            if (nextUnviewed) onSelect(nextUnviewed.path)
          }}
        >
          Next unviewed
        </Button>
      </div>
      {error && (
        <p role="alert" className="flex items-center gap-2 text-xs text-destructive">
          {error}
          <Button size="sm" variant="ghost" onClick={onRetry}>
            Retry
          </Button>
        </p>
      )}
    </div>
  )
}
export function ReviewFiles({
  files,
  groups,
  related,
  onRelatedChange,
  selected,
  onSelect,
  disabled = false,
  showTypeFilters = true,
  weightBy = 'files',
}: {
  files: ReviewListFile[]
  groups: ReviewGroup[]
  related: boolean
  onRelatedChange: (value: boolean) => void
  selected: string
  onSelect: (path: string) => void
  disabled?: boolean
  showTypeFilters?: boolean
  weightBy?: 'files' | 'lines'
}) {
  const [query, setQuery] = useState(''),
    [unviewed, setUnviewed] = useState(false)
  const [kind, setKind] = useState<FileKind>()
  const categorized = useMemo(
    () => files.map((file) => ({ ...file, changeKind: file.changeKind ?? pullFileKind(file) })),
    [files],
  )
  const filter = useDeferredValue(query.trim().toLowerCase())
  const filtered = useMemo(
    () =>
      categorized.filter(
        (file) =>
          (!kind || file.changeKind === kind) &&
          (!unviewed || !file.viewed) &&
          file.path.toLowerCase().includes(filter),
      ),
    [categorized, filter, unviewed, kind],
  )
  const grouped = useMemo(() => {
    const remaining = new Map(filtered.map((file) => [file.path, file]))
    const sections: {
      label: string
      basis: ReviewGroup['basis']
      summary?: string
      impact?: string
      files: ReviewListFile[]
    }[] = []
    if (related)
      for (const group of groups) {
        if (group.basis !== 'feature') continue
        const members = group.paths.flatMap((path) => {
          const file = remaining.get(path)
          if (!file) return []
          remaining.delete(path)
          return [file]
        })
        if (members.length) sections.push({ ...group, files: members })
      }
    return { sections, remaining: [...remaining.values()] }
  }, [filtered, related, groups])
  return (
    <>
      <div className="shrink-0 space-y-2 border-b bg-sidebar/40 p-2">
        {showTypeFilters && (
          <ChangeTypeFilters files={files} weightBy={weightBy} value={kind} onChange={setKind} />
        )}
        <SearchField
          role="searchbox"
          aria-label="Search changed files"
          placeholder="Search files…"
          value={query}
          onValueChange={setQuery}
          clearLabel="Clear file search"
          className="text-xs"
        />
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {groups.some((group) => group.basis === 'feature') && (
            <Button
              size="sm"
              variant="ghost"
              aria-pressed={related}
              onClick={() => onRelatedChange(!related)}
            >
              {related ? 'Features' : 'Folders'}
            </Button>
          )}
          <label className="flex min-h-8 items-center gap-2">
            <Checkbox
              checked={unviewed}
              onCheckedChange={(checked) => setUnviewed(checked === true)}
            />
            Unviewed only
          </label>
        </div>
      </div>
      <nav
        aria-label="Changed files"
        className="min-h-0 flex-1 overflow-auto overscroll-contain p-1.5"
      >
        {!filtered.length && (
          <p className="p-2 text-xs text-muted-foreground">
            {unviewed && !filter && !kind ? 'All files viewed.' : 'No matching files.'}
          </p>
        )}
        {grouped.sections.map((section) => (
          <details
            key={`${section.basis}:${section.label}`}
            open
            className="group/review mb-2 rounded-lg border border-border/40 bg-card/20"
          >
            <summary
              className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-2 text-xs font-medium"
              title="Model-proposed feature group; verify against its diffs"
            >
              <ChevronRight
                aria-hidden
                className="size-3 shrink-0 transition-transform group-open/review:rotate-90"
              />
              <Layers aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{section.label}</span>
              <span className="text-[0.625rem] tabular-nums text-muted-foreground">
                {section.files.filter((file) => file.viewed).length}/{section.files.length}
              </span>
            </summary>
            {section.summary && <p className="px-3 pb-2 text-xs">{section.summary}</p>}
            {section.impact && (
              <p className="px-3 pb-2 text-xs text-muted-foreground">
                <span className="font-medium">Linked impact: </span>
                {section.impact}
              </p>
            )}
            <div className="p-1 pt-0">
              <FileBrowserTree
                files={section.files}
                flat
                selected={selected}
                onSelect={onSelect}
                disabled={disabled}
              />
            </div>
          </details>
        ))}
        <FileBrowserTree
          files={grouped.remaining}
          selected={selected}
          onSelect={onSelect}
          disabled={disabled}
          search={filter}
        />
      </nav>
    </>
  )
}
