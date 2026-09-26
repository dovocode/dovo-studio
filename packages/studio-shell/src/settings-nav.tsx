import type { SettingsSection, StudioView } from '@dovo/studio-core'
import { useApplicationState } from '@dovo/studio-core/state'
import { Input } from '@dovo/studio-ui'
import { Search } from 'lucide-react'

const headings: readonly [SettingsSection | 'more', string][] = [
  ['app', 'App'],
  ['agents', 'Agents'],
  ['coding', 'Coding'],
  ['computers', 'Computers'],
  ['archived', 'Archived'],
  ['more', 'More'],
]

/** Grouped settings navigation with search, organized like Codex and T3 Code. */
export function SettingsNav({
  views,
  activeId,
  onSelect,
}: {
  views: readonly StudioView[]
  activeId: string
  onSelect: (viewId: string) => void
}) {
  const [query, setQuery] = useApplicationState('')
  const needle = query.trim().toLowerCase()
  const matches = views.filter(
    (view) =>
      !needle ||
      `${view.title} ${view.keywords ?? ''}`
        .toLowerCase()
        .split(/\s+/)
        .some((word) => word.startsWith(needle)) ||
      view.title.toLowerCase().includes(needle),
  )
  return (
    <nav
      aria-label="Settings sections"
      className="flex w-56 shrink-0 flex-col gap-4 overflow-y-auto border-r bg-sidebar px-3 py-4"
    >
      <div className="px-1">
        <h1 className="mb-3 text-sm font-semibold">Settings</h1>
        <div className="relative">
          <Search
            aria-hidden="true"
            className="absolute left-2 top-2 size-3.5 text-muted-foreground"
          />
          <Input
            aria-label="Search settings"
            placeholder="Search settings"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && matches[0]) onSelect(matches[0].id)
              if (event.key === 'Escape') setQuery('')
            }}
            className="h-8 pl-7 text-xs"
          />
        </div>
      </div>
      {headings.map(([section, label]) => {
        const items = matches
          .filter((view) => (view.settingsSection ?? 'more') === section)
          .sort((a, b) => a.order - b.order)
        if (!items.length) return null
        return (
          <div key={section} className="space-y-0.5">
            <h2 className="px-2 pb-1 text-[0.6875rem] font-medium uppercase tracking-wide text-muted-foreground">
              {label}
            </h2>
            {items.map((view) => (
              <button
                key={view.id}
                type="button"
                aria-current={activeId === view.id ? 'page' : undefined}
                onClick={() => onSelect(view.id)}
                className={`block w-full truncate rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                  activeId === view.id
                    ? 'bg-muted font-medium text-foreground'
                    : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                }`}
              >
                {view.title}
              </button>
            ))}
          </div>
        )
      })}
      {!matches.length && (
        <p className="px-2 text-xs text-muted-foreground">No settings match “{query}”.</p>
      )}
    </nav>
  )
}
