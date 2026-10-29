import { useId, useState, type RefObject } from 'react'
import { History, Star, PanelsTopLeft } from 'lucide-react'
import { Input } from '@dovo/studio-ui'
import { isPrivateBrowserProfile } from '@dovo/protocol'
import { browserPageKey, type BrowserTab } from './shared-browser-tabs'

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
}: {
  value: string
  onChange: (value: string) => void
  inputRef: RefObject<HTMLInputElement | null>
  disabled: boolean
  shared: boolean
  tabs: BrowserTab[]
  bookmarks: BrowserTab[]
  visits: BrowserTab[]
  profileId: string
  onChoose: (tab: BrowserTab) => void
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
  const shown = suggestions.length > 0
  const choose = (tab: BrowserTab) => {
    setOpen(false)
    onEditing(false)
    onChange(tab.url)
    inputRef.current?.blur()
    onChoose(tab)
  }
  return (
    <div className="min-w-0 flex-1 self-stretch">
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
        aria-activedescendant={shown && active >= 0 ? `${id}-${active}` : undefined}
        aria-label="Preview URL"
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
                ? (current + 1) % suggestions.length
                : current <= 0
                  ? suggestions.length - 1
                  : current - 1,
            )
          }
          if (event.key === 'Enter' && shown && active >= 0 && suggestions[active]) {
            event.preventDefault()
            choose(suggestions[active].tab)
          } else if (event.key === 'Enter') {
            setOpen(false)
          }
        }}
        placeholder={shared ? 'Search or enter address' : 'Enter website address'}
        className="h-full min-w-0 border-0 bg-transparent px-0 text-center text-[13px] shadow-none focus:text-left focus-visible:outline-none focus-visible:ring-0 [@media(pointer:coarse)]:text-base"
      />
      {shown && (
        <div
          id={id}
          role="listbox"
          aria-label="Address suggestions"
          className="absolute left-0 top-full z-50 mt-2 max-h-80 w-full overflow-y-auto rounded-xl border bg-popover p-1 text-popover-foreground shadow-xl"
        >
          {suggestions.map(({ tab, source }, index) => {
            const Glyph = source === 'Tab' ? PanelsTopLeft : source === 'Bookmark' ? Star : History
            return (
              <div
                key={browserPageKey(tab)}
                id={`${id}-${index}`}
                role="option"
                aria-selected={index === active}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(tab)}
                onPointerMove={() => setActive(index)}
                className={`flex cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-xs ${index === active ? 'bg-accent' : 'hover:bg-accent/50'}`}
              >
                <Glyph size={14} className="shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{tab.title || tab.url}</p>
                  <p className="truncate text-muted-foreground">{tab.url}</p>
                </div>
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  {source === 'Tab' ? 'Switch to tab' : source}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
