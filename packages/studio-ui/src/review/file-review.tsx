import { useDeferredValue, useMemo, useState } from 'react'
import type { ReviewGroup } from '@dovo/protocol'
import { Button } from '../components/ui/button'
import { Checkbox } from '../components/ui/checkbox'
export type ReviewListFile = { path: string; viewed: boolean; label?: string }
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
        <label className="flex min-h-8 items-center gap-2">
          <Checkbox
            aria-label="File viewed"
            checked={file?.viewed ?? false}
            disabled={disabled || busy || !file}
            onCheckedChange={(checked) => onViewed(checked === true)}
          />
          {busy ? 'Saving…' : 'Viewed'}
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
}: {
  files: ReviewListFile[]
  groups: ReviewGroup[]
  related: boolean
  onRelatedChange: (value: boolean) => void
  selected: string
  onSelect: (path: string) => void
  disabled?: boolean
}) {
  const [query, setQuery] = useState(''),
    [unviewed, setUnviewed] = useState(false)
  const filter = useDeferredValue(query.trim().toLowerCase())
  const filtered = useMemo(
    () =>
      files.filter(
        (file) => (!unviewed || !file.viewed) && file.path.toLowerCase().includes(filter),
      ),
    [files, filter, unviewed],
  )
  const sections = useMemo(() => {
    const remaining = new Map(filtered.map((file) => [file.path, file]))
    const sections: { label: string; basis: 'ast' | 'folder'; files: ReviewListFile[] }[] = []
    if (related)
      for (const group of groups) {
        const members = group.paths.flatMap((path) => {
          const file = remaining.get(path)
          if (!file) return []
          remaining.delete(path)
          return [file]
        })
        if (members.length)
          sections.push({ label: group.label, basis: group.basis, files: members })
      }
    const folders = new Map<string, ReviewListFile[]>()
    for (const file of [...remaining.values()].sort((a, b) => a.path.localeCompare(b.path))) {
      const folder = file.path.includes('/')
        ? file.path.slice(0, file.path.lastIndexOf('/'))
        : 'Root files'
      const members = folders.get(folder) ?? []
      members.push(file)
      folders.set(folder, members)
    }
    for (const [label, files] of folders) sections.push({ label, files, basis: 'folder' })
    return sections
  }, [filtered, related, groups])
  return (
    <>
      <div className="shrink-0 space-y-2 border-b p-2">
        <input
          type="search"
          aria-label="Search changed files"
          placeholder="Search files…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="h-8 w-full rounded border bg-background px-2 text-xs"
        />
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Button
            size="sm"
            variant="ghost"
            aria-pressed={related}
            onClick={() => onRelatedChange(!related)}
          >
            {related ? 'Related changes' : 'Folders'}
          </Button>
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
        className="min-h-0 flex-1 overflow-auto overscroll-contain p-2"
      >
        {!filtered.length && (
          <p className="p-2 text-xs text-muted-foreground">
            {unviewed && !filter ? 'All files viewed.' : 'No matching files.'}
          </p>
        )}
        {sections.map((section) => (
          <details key={`${section.basis}:${section.label}`} open className="mb-2">
            <summary
              className="cursor-pointer break-all px-2 py-2 text-xs font-medium text-muted-foreground"
              title={
                section.basis === 'ast'
                  ? 'Dependencies first, followed by files that import them'
                  : 'Folder order; no reliable dependency link available'
              }
            >
              {section.basis === 'ast' ? 'Related · ' : 'Folder · '}
              {section.label}
            </summary>
            {section.files.map((file) => (
              <button
                key={file.path}
                title={file.path}
                aria-current={selected === file.path ? 'true' : undefined}
                disabled={disabled}
                onClick={() => onSelect(file.path)}
                className={`flex min-h-10 w-full items-center gap-2 rounded px-2 py-2 text-left text-xs disabled:opacity-50 ${selected === file.path ? 'bg-accent' : 'hover:bg-accent/50'}`}
              >
                <span
                  aria-label={file.viewed ? 'Viewed' : 'Unviewed'}
                  className={file.viewed ? 'text-emerald-500' : 'text-muted-foreground'}
                >
                  {file.viewed ? '✓' : '○'}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{file.path.split('/').at(-1)}</span>
                  {section.basis === 'ast' && (
                    <span className="block truncate text-[0.6875rem] text-muted-foreground">
                      {file.path.slice(0, file.path.lastIndexOf('/')) || 'Root'}
                    </span>
                  )}
                </span>
                {file.label && (
                  <span className="shrink-0 text-[0.6875rem] text-muted-foreground">
                    {file.label}
                  </span>
                )}
              </button>
            ))}
          </details>
        ))}
      </nav>
    </>
  )
}
