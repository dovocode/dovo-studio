import { useId, useState, type RefObject } from 'react'
import {
  History,
  Star,
  PanelsTopLeft,
  Search,
  Globe2,
  LockKeyhole,
  ArrowUpRight,
} from 'lucide-react'
import { Input } from '@dovo/studio-ui'
import {
  browserSearchUrl,
  browserSearchProviders,
  type BrowserSearchEngine,
  isPrivateBrowserProfile,
} from '@dovo/protocol'
import { browserAddressIntent, browserPageKey, type BrowserTab } from './shared-browser-tabs'

type Suggestion = { tab: BrowserTab; source: 'Tab' | 'Bookmark' | 'History' }
export function browserAddressSuggestions(
  query: string,
  tabs: BrowserTab[],
  bookmarks: BrowserTab[],
  visits: BrowserTab[],
  profileId: string,
): Suggestion[] {
  const privateProfile = isPrivateBrowserProfile(profileId)
  const seen = new Set<string>()
  const result: Suggestion[] = []
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const groups = [
    { items: tabs, source: 'Tab' as const },
    ...(!privateProfile
      ? [
          { items: bookmarks, source: 'Bookmark' as const },
          { items: visits, source: 'History' as const },
        ]
      : []),
  ]
  for (const { items, source } of groups) {
    for (const tab of items) {
      if (
        !tab.url ||
        !/^https?:\/\//i.test(tab.url) ||
        tab.previewOf ||
        (privateProfile ? tab.profileId !== profileId : isPrivateBrowserProfile(tab.profileId))
      )
        continue
      const key = browserPageKey(tab)
      if (
        seen.has(key) ||
        !terms.every((term) => `${tab.title} ${tab.url}`.toLowerCase().includes(term))
      )
        continue
      seen.add(key)
      result.push({ tab, source })
      if (result.length === 8) return result
    }
  }
  return result
}
export function BrowserAddressInput({
  value,
  onChange,
  inputRef,
  disabled,
  shared,
  tabs,
  bookmarks,
  visits,
  profileId,
  onChoose,
  onEditing,
  search,
  onNavigate,
  label = 'Preview URL',
}: {
  label?: string
  value: string
  onChange: (value: string) => void
  inputRef: RefObject<HTMLInputElement | null>
  disabled: boolean
  shared: boolean
  tabs: BrowserTab[]
  bookmarks: BrowserTab[]
  visits: BrowserTab[]
  profileId: string
  onChoose: (tab: BrowserTab, newTab: boolean) => void
  search?: BrowserSearchEngine
  onNavigate: (url: string, newTab: boolean) => void
  onEditing: (editing: boolean) => void
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState(false)
  const [active, setActive] = useState(-1)
  const suggestions =
    shared && open
      ? browserAddressSuggestions(typed ? value : '', tabs, bookmarks, visits, profileId)
      : []
  const query = value.trim()
  let intent: ReturnType<typeof browserAddressIntent> | undefined
  let addressError = ''
  if (shared && open && typed && query) {
    try {
      intent = browserAddressIntent(query, search)
    } catch (cause) {
      addressError = cause instanceof Error ? cause.message : String(cause)
    }
  }
  const provider =
    search?.engine === 'custom'
      ? 'your search engine'
      : (browserSearchProviders.find((item) => item.id === (search?.engine ?? 'google'))?.name ??
        'Google')
  let alternativeUrl: string | undefined
  if (intent?.kind === 'navigate') {
    try {
      alternativeUrl = browserSearchUrl(query, search)
    } catch {
      /* An address can fit even when its encoded search query is too long. */
    }
  }
  const alternative = !!alternativeUrl
  const last = suggestions.length + (alternative ? 1 : 0) - 1
  const shown = suggestions.length > 0 || !!intent || !!addressError
  const submit = (target: string, newTab: boolean) => {
    setOpen(false)
    onEditing(false)
    inputRef.current?.blur()
    onNavigate(target, newTab)
  }
  const searchInstead = (newTab: boolean) => {
    if (alternativeUrl) submit(alternativeUrl, newTab)
  }
  const choose = (tab: BrowserTab, newTab: boolean) => {
    setOpen(false)
    onEditing(false)
    onChange(tab.url)
    inputRef.current?.blur()
    onChoose(tab, newTab)
  }
  return (
    <div className="flex min-w-0 flex-1 items-center self-stretch">
      <span
        className="flex w-9 shrink-0 justify-center text-muted-foreground [@media(pointer:coarse)]:w-11"
        aria-hidden="true"
      >
        {intent?.kind === 'search' ? (
          <Search size={15} />
        ) : /^https:\/\//i.test(value) ? (
          <LockKeyhole size={15} />
        ) : (
          <Globe2 size={15} />
        )}
      </span>
      <Input
        ref={inputRef}
        type="text"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        role={shared ? 'combobox' : undefined}
        aria-autocomplete={shared ? 'list' : undefined}
        aria-expanded={shared ? shown : undefined}
        aria-controls={shown ? id : undefined}
        aria-activedescendant={shown && (active >= 0 || intent) ? `${id}-${active}` : undefined}
        aria-label={label}
        disabled={disabled}
        value={value}
        onFocus={(event) => {
          onEditing(true)
          event.currentTarget.select()
          setTyped(false)
          setActive(-1)
          setOpen(true)
        }}
        onBlur={() => {
          onEditing(false)
          setOpen(false)
        }}
        onChange={(event) => {
          onChange(event.target.value)
          setTyped(true)
          setOpen(true)
          setActive(-1)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && open) {
            event.preventDefault()
            event.stopPropagation()
            setOpen(false)
            setActive(-1)
          }
          if (shown && ['ArrowDown', 'ArrowUp'].includes(event.key)) {
            event.preventDefault()
            setActive((current) =>
              event.key === 'ArrowDown'
                ? current >= last
                  ? -1
                  : current + 1
                : current < 0
                  ? last
                  : current - 1,
            )
          }
          if (event.nativeEvent.isComposing) return
          if (
            event.key === 'Enter' &&
            intent &&
            active === -1 &&
            (event.ctrlKey || event.metaKey)
          ) {
            event.preventDefault()
            submit(intent.url, true)
          } else if (
            event.key === 'Enter' &&
            shown &&
            alternative &&
            active === suggestions.length
          ) {
            event.preventDefault()
            searchInstead(event.ctrlKey || event.metaKey)
          } else if (event.key === 'Enter' && shown && active >= 0 && suggestions[active]) {
            event.preventDefault()
            choose(suggestions[active].tab, event.ctrlKey || event.metaKey)
          } else if (event.key === 'Enter') {
            setOpen(false)
          }
        }}
        placeholder={shared ? 'Search or enter address' : 'Enter website address'}
        className="h-full min-w-0 border-0 bg-transparent px-0 text-left text-[13px] shadow-none focus-visible:outline-none focus-visible:ring-0 [@media(pointer:coarse)]:text-base"
      />
      {shown && (
        <div
          id={id}
          role="listbox"
          aria-label="Address suggestions"
          className="absolute left-0 top-full z-50 mt-2 max-h-[min(28rem,60vh)] w-full overflow-y-auto rounded-2xl border bg-popover p-1.5 text-popover-foreground shadow-xl"
        >
          {intent && (
            <div
              id={`${id}--1`}
              role="option"
              aria-selected={active === -1}
              onMouseDown={(event) => event.preventDefault()}
              onPointerMove={() => setActive(-1)}
              onClick={(event) => submit(intent.url, event.ctrlKey || event.metaKey)}
              className={`flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-xs ${active === -1 ? 'bg-accent' : 'hover:bg-accent/50'}`}
            >
              <span className="rounded-lg bg-primary/10 p-2 text-primary" aria-hidden="true">
                {intent.kind === 'search' ? <Search size={16} /> : <Globe2 size={16} />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">
                  {intent.kind === 'search' ? query : intent.url}
                </p>
                <p className="text-muted-foreground">
                  {intent.kind === 'search' ? `Search with ${provider}` : 'Go to website'}
                </p>
              </div>
              <span className="shrink-0 text-[10px] text-muted-foreground" aria-hidden="true">
                ↵
              </span>
            </div>
          )}
          {addressError && <p className="px-3 py-2 text-xs text-destructive">{addressError}</p>}
          {suggestions.length > 0 && (
            <p className="px-3 pb-1 pt-2 text-[10px] font-medium text-muted-foreground">
              Tabs, bookmarks & history
            </p>
          )}
          {suggestions.map(({ tab, source }, index) => {
            const Glyph = source === 'Tab' ? PanelsTopLeft : source === 'Bookmark' ? Star : History
            return (
              <div
                key={browserPageKey(tab)}
                id={`${id}-${index}`}
                role="option"
                aria-selected={index === active}
                onMouseDown={(event) => event.preventDefault()}
                onClick={(event) => choose(tab, event.ctrlKey || event.metaKey)}
                onContextMenu={(event) => {
                  // macOS delivers Control-click as a context menu event.
                  if (event.ctrlKey) {
                    event.preventDefault()
                    choose(tab, true)
                  }
                }}
                onPointerMove={() => setActive(index)}
                className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-xs ${index === active ? 'bg-accent' : 'hover:bg-accent/50'}`}
              >
                <Glyph size={14} className="shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{tab.title || tab.url}</p>
                  <p className="truncate text-muted-foreground">{tab.url}</p>
                </div>
                <span className="shrink-0 text-[10px] text-muted-foreground">{source}</span>
              </div>
            )
          })}
          {alternative && (
            <div
              id={`${id}-${suggestions.length}`}
              role="option"
              aria-selected={active === suggestions.length}
              onMouseDown={(event) => event.preventDefault()}
              onPointerMove={() => setActive(suggestions.length)}
              onClick={(event) => searchInstead(event.ctrlKey || event.metaKey)}
              className={`flex cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-xs ${active === suggestions.length ? 'bg-accent' : 'hover:bg-accent/50'}`}
            >
              <Search size={14} className="shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">
                Search {provider} for “{query}”
              </span>
              <ArrowUpRight size={14} className="shrink-0 text-muted-foreground" />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
