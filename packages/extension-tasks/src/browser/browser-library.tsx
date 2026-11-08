import { BrowserFavicon } from './browser-favicon'
import { useBrowserProfileName } from './browser-profile-label'
import { useWorkspace } from '@dovo/studio-core'
import { runtimeComputerName } from '@dovo/protocol'
import { useState } from 'react'
import { Trash2 } from 'lucide-react'
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
  view: 'bookmarks' | 'history'
  onClose: () => void
  bookmarks: readonly BrowserTab[]
  closed: readonly BrowserTab[]
  visits: readonly BrowserTab[]
  onOpen: (tab: BrowserTab) => void
  onRemoveBookmark: (tab: BrowserTab) => void
  onClearHistory: () => void
  onReopen: () => void
}

function BrowserLibraryEntry({
  tab,
  query,
  onOpen,
  onRemove,
}: {
  tab: BrowserTab
  query: string
  onOpen: () => void
  onRemove?: () => void
}) {
  const { runtimes } = useWorkspace()
  const profile = useBrowserProfileName(tab)
  const owner = runtimes.find((entry) => entry.profile.id === tab.runtimeId)
  const computer =
    tab.kind === 'web'
      ? 'Local · this device'
      : `Remote · ${owner ? runtimeComputerName(owner) : 'Unavailable computer'}`
  const source = `${computer} · ${profile}`
  if (!`${tab.title} ${tab.url} ${source}`.toLowerCase().includes(query.trim().toLowerCase()))
    return null
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        className="min-w-0 flex-1 rounded-md px-3 py-2 text-left hover:bg-accent focus-visible:bg-accent"
        onClick={onOpen}
      >
        <span className="flex min-w-0 items-center gap-2 text-sm">
          <BrowserFavicon tab={tab} />
          <span className="truncate">{tab.title || tab.url || 'Untitled page'}</span>
        </span>
        <span className="block truncate text-xs text-muted-foreground">{tab.url}</span>
        <span className="block truncate text-xs text-muted-foreground">{source}</span>
      </button>
      {onRemove && (
        <Button
          size="icon"
          variant="ghost"
          aria-label={`Remove bookmark ${tab.title || tab.url}`}
          onClick={onRemove}
        >
          <Trash2 size={14} />
        </Button>
      )}
    </div>
  )
}

export function BrowserLibrary({
  view,
  onClose,
  bookmarks,
  closed,
  visits,
  onOpen,
  onRemoveBookmark,
  onClearHistory,
  onReopen,
}: BrowserLibraryProps) {
  const [query, setQuery] = useState('')
  const title = view === 'history' ? 'History' : 'Bookmarks'
  const sections =
    view === 'history'
      ? [
          { title: 'History', tabs: visits },
          { title: 'Recently closed', tabs: closed },
        ]
      : [{ title: 'Bookmarks', tabs: bookmarks }]
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>
          Open a saved page on its original computer and browser profile.
        </DialogDescription>
        <Input
          aria-label={`Search ${title.toLowerCase()}`}
          placeholder="Search pages, computers or profiles…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {view === 'history' && (
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={!closed.length}
              onClick={() => {
                onReopen()
                onClose()
              }}
            >
              Reopen last closed tab
            </Button>
            <Button size="sm" variant="ghost" disabled={!visits.length} onClick={onClearHistory}>
              Clear history
            </Button>
          </div>
        )}
        <div className="max-h-[55vh] space-y-4 overflow-y-auto">
          {sections.map(({ title, tabs }) => (
            <section key={title} aria-label={title}>
              <h3 className="mb-1 text-sm font-medium">{title}</h3>
              <div>
                {tabs.map((tab, index) => (
                  <BrowserLibraryEntry
                    key={`${browserPageKey(tab)}:${index}`}
                    tab={tab}
                    query={query}
                    onOpen={() => {
                      onOpen(tab)
                      onClose()
                    }}
                    onRemove={title === 'Bookmarks' ? () => onRemoveBookmark(tab) : undefined}
                  />
                ))}
                {/* Profile catalogs load in each entry; show this only when no entries match. */}
                <p className="hidden px-3 py-2 text-xs text-muted-foreground only:block">
                  {query.trim() ? 'No matching pages.' : `No ${title.toLowerCase()} yet.`}
                </p>
              </div>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
