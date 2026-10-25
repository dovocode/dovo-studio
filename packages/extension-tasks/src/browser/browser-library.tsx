import { useState } from 'react'
import { BookOpen, Trash2 } from 'lucide-react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  Input,
} from '@dovo/studio-ui'
import { browserPageKey, type BrowserTab } from './shared-browser-tabs'

export type BrowserLibraryProps = {
  bookmarks: readonly BrowserTab[]
  closed: readonly BrowserTab[]
  visits: readonly BrowserTab[]
  onOpen: (tab: BrowserTab) => void
  onRemoveBookmark: (tab: BrowserTab) => void
  onClearHistory: () => void
  describeSource?: (tab: BrowserTab) => string
  onReopen: () => void
}

export function BrowserLibrary({
  bookmarks,
  closed,
  visits,
  onOpen,
  onRemoveBookmark,
  onClearHistory,
  onReopen,
  describeSource,
}: BrowserLibraryProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const source = (tab: BrowserTab) =>
    describeSource?.(tab) ??
    `${tab.kind === 'remote' ? `Remote computer: ${tab.runtimeId || 'Unavailable'}` : 'Local computer'} · Profile: ${tab.profileId}`
  const matches = (tab: BrowserTab) =>
    `${tab.title} ${tab.url} ${source(tab)}`.toLowerCase().includes(query.trim().toLowerCase())
  const sections = [
    { title: 'Bookmarks', tabs: bookmarks },
    { title: 'History', tabs: visits },
    { title: 'Recently closed', tabs: closed },
  ]
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        className="w-full min-w-0 justify-start"
        aria-label="Bookmarks and history"
        title="Bookmarks and history"
        onClick={() => {
          setQuery('')
          setOpen(true)
        }}
      >
        <BookOpen size={14} className="shrink-0" />
        <span className="min-w-0 truncate">Bookmarks and history</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogTitle>Bookmarks and history</DialogTitle>
          <DialogDescription>
            Open a saved page on its original computer and browser profile.
          </DialogDescription>
          <Input
            aria-label="Search bookmarks and history"
            placeholder="Search pages, computers or profiles…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!closed.length}
              onClick={() => {
                onReopen()
                setOpen(false)
              }}
            >
              Reopen last closed tab
            </Button>
            <Button size="sm" variant="ghost" disabled={!visits.length} onClick={onClearHistory}>
              Clear history
            </Button>
          </div>
          <div className="max-h-[55vh] space-y-4 overflow-y-auto">
            {sections.map(({ title, tabs }) => {
              const filtered = tabs.filter(matches)
              return (
                <section key={title} aria-label={title}>
                  <h3 className="mb-1 text-sm font-medium">{title}</h3>
                  {filtered.length ? (
                    filtered.map((tab, index) => (
                      <div
                        key={`${browserPageKey(tab)}:${index}`}
                        className="flex items-center gap-1"
                      >
                        <button
                          type="button"
                          className="min-w-0 flex-1 rounded-md px-3 py-2 text-left hover:bg-accent focus-visible:bg-accent"
                          onClick={() => {
                            onOpen(tab)
                            setOpen(false)
                          }}
                        >
                          <span className="block truncate text-sm">
                            {tab.title || tab.url || 'Untitled page'}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {tab.url}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {source(tab)}
                          </span>
                        </button>
                        {title === 'Bookmarks' && (
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`Remove bookmark ${tab.title || tab.url}`}
                            onClick={() => onRemoveBookmark(tab)}
                          >
                            <Trash2 size={14} />
                          </Button>
                        )}
                      </div>
                    ))
                  ) : (
                    <p className="px-3 py-2 text-xs text-muted-foreground">
                      {query.trim() ? 'No matching pages.' : `No ${title.toLowerCase()} yet.`}
                    </p>
                  )}
                </section>
              )
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
