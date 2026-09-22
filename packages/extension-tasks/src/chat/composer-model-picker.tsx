import { useId, useState } from 'react'
import { Bot, Check, ChevronDown, Search, Star, Settings2 } from 'lucide-react'
import {
  defaultTaskHarness,
  providers,
  providerSchema,
  type Agent,
  type TaskHarness,
} from '@dovo/studio-core'
import { AgentAvatar, Button, Input, Popover, cn } from '@dovo/studio-ui'
import { HarnessIcon } from './harness-icon'
import { useHarnessCatalog } from './harness-catalog'
const favoritesKey = 'dovo:model-favorites'
type PickerItem = {
  id: string
  name: string
  provider: TaskHarness['provider']
  hidden?: boolean
  agent?: Agent
}
export function ComposerModelPicker({
  value,
  disabled,
  onChange,
  onConfigure,
  agents,
  selectedAgent,
  onSelectAgent,
  onUseHarness,
  lockedProvider,
}: {
  agents: readonly Agent[]
  selectedAgent?: Agent
  onSelectAgent: (agentId: string) => Promise<boolean>
  onUseHarness: (provider: TaskHarness['provider']) => Promise<boolean>
  lockedProvider?: TaskHarness['provider']
  value: TaskHarness
  disabled: boolean
  onChange: (next: TaskHarness) => Promise<boolean>
  onConfigure: () => void
}) {
  const [open, setOpen] = useState(false)
  const [provider, setProvider] = useState(value.provider)
  const [mode, setMode] = useState<'models' | 'favorites' | 'agents'>('models')
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [legacy, setLegacy] = useState(false)
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      return localStorage.getItem(favoritesKey)?.split('\n').filter(Boolean) ?? []
    } catch {
      return []
    }
  })
  const [storageError, setStorageError] = useState('')
  const activeProvider = lockedProvider ?? provider
  const selectedHarness =
    activeProvider === value.provider ? value : defaultTaskHarness(activeProvider)
  const { catalog, loading, error } = useHarnessCatalog(selectedHarness, open && mode === 'models')
  const listId = useId()
  const items: PickerItem[] =
    mode === 'agents'
      ? agents.map((agent) => ({
          id: agent.id,
          name: agent.name,
          provider: agent.provider,
          hidden: false,
          agent,
        }))
      : mode === 'favorites'
        ? favorites.flatMap((key) => {
            const provider = providerSchema.options.find((p) => key.startsWith(`${p}:`))
            return provider
              ? [
                  {
                    id: key.slice(provider.length + 1),
                    name: key.slice(provider.length + 1) || 'Provider default',
                    provider,
                    hidden: false,
                  },
                ]
              : []
          })
        : [
            { id: '', name: 'Provider default', provider: activeProvider, hidden: false },
            ...(catalog?.models ?? []).map((model) => ({ ...model, provider: activeProvider })),
            ...(query.trim() && !catalog?.models.some((m) => m.id === query.trim())
              ? [
                  {
                    id: query.trim(),
                    name: `Use custom model “${query.trim()}”`,
                    provider: activeProvider,
                    hidden: false,
                  },
                ]
              : []),
          ]
  const filtered = items.filter(
    (item) =>
      (!lockedProvider || item.provider === lockedProvider) &&
      (legacy || !item.hidden || query.trim()) &&
      `${item.name} ${item.id} ${item.agent?.model ?? ''} ${providers[item.provider].short}`
        .toLowerCase()
        .includes(query.toLowerCase().trim()),
  )
  const choose = async (item: (typeof items)[number]) => {
    if (disabled || (lockedProvider && item.provider !== lockedProvider)) return
    if (item.agent) {
      if (await onSelectAgent(item.agent.id)) setOpen(false)
      return
    }
    const saved = await onChange({
      ...(item.provider === value.provider ? value : defaultTaskHarness(item.provider)),
      model: item.id,
      reasoning: item.id === value.model && item.provider === value.provider ? value.reasoning : '',
      cyberAccessProgram:
        item.id === value.model && item.provider === value.provider
          ? value.cyberAccessProgram
          : undefined,
      serviceTier:
        item.id === value.model && item.provider === value.provider ? value.serviceTier : undefined,
    })
    if (saved) setOpen(false)
  }
  return (
    <Popover.Root
      open={open && !disabled}
      onOpenChange={(next) => {
        setOpen(next)
        setProvider(value.provider)
        setMode(selectedAgent ? 'agents' : 'models')
        setQuery('')
        setActive(0)
      }}
    >
      <Popover.Trigger asChild>
        <Button
          type="button"
          variant="ghost"
          disabled={disabled}
          aria-label="Choose agent and model"
          className="h-8 min-w-0 max-w-64 gap-1.5 rounded-lg px-2 text-xs font-normal"
        >
          <AgentAvatar
            provider={value.provider}
            customIcon={selectedAgent ? (selectedAgent.icon ?? 'bot') : undefined}
          />
          <span className="truncate">
            {selectedAgent && `${selectedAgent.name} · `}
            {(activeProvider === value.provider
              ? catalog?.models.find((model) => model.id === value.model)?.name
              : undefined) ||
              value.model ||
              providers[value.provider].short}
          </span>
          <ChevronDown className="size-3 text-muted-foreground" />
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="z-50 flex h-[min(27rem,var(--radix-popover-content-available-height))] w-[min(26rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-2xl"
          aria-label="Choose agent and model"
        >
          <div
            className="flex w-12 shrink-0 flex-col items-center gap-1 border-r p-1.5"
            aria-label="Harnesses"
          >
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Favorite models"
              aria-pressed={mode === 'favorites'}
              onClick={() => {
                setMode('favorites')
                setQuery('')
                setActive(0)
              }}
              className={cn('size-9', mode === 'favorites' && 'bg-accent')}
            >
              <Star className="size-4" />
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Custom agents"
              title="Custom agents"
              aria-pressed={mode === 'agents'}
              className={cn('size-9', mode === 'agents' && 'bg-accent')}
              onClick={() => {
                setMode('agents')
                setQuery('')
                setActive(0)
              }}
            >
              <Bot className="size-4" />
            </Button>
            <div className="my-1 w-full border-t" />
            {providerSchema.options
              .filter((p) => !lockedProvider || p === lockedProvider)
              .map((p) => (
                <Button
                  key={p}
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`${providers[p].short} models`}
                  aria-pressed={mode === 'models' && p === activeProvider}
                  title={providers[p].short}
                  className={cn(
                    'size-9',
                    mode === 'models' &&
                      p === activeProvider &&
                      'bg-accent text-primary ring-1 ring-inset ring-primary/50',
                  )}
                  onClick={() => {
                    setProvider(p)
                    setMode('models')
                    setActive(0)
                    setQuery('')
                  }}
                >
                  <HarnessIcon provider={p} className="size-4" />
                </Button>
              ))}
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Agent configuration"
              title="Agent configuration"
              className="mt-auto size-9"
              onClick={() => {
                setOpen(false)
                onConfigure()
              }}
            >
              <Settings2 className="size-4" />
            </Button>
          </div>
          <div className="flex min-w-0 flex-1 flex-col p-2">
            <div className="relative mb-2 border-b pb-2">
              <Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" />
              <Input
                autoFocus
                aria-label={mode === 'agents' ? 'Search custom agents' : 'Search models'}
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={
                  filtered.length ? `${listId}-${Math.min(active, filtered.length - 1)}` : undefined
                }
                placeholder={mode === 'agents' ? 'Search custom agents…' : 'Search models…'}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value)
                  setActive(0)
                }}
                className="h-9 rounded-none border-0 bg-transparent pl-8 shadow-none focus-visible:ring-0"
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault()
                    const next =
                      (active + (event.key === 'ArrowDown' ? 1 : -1) + filtered.length) %
                      Math.max(filtered.length, 1)
                    setActive(next)
                    document
                      .getElementById(`${listId}-${next}`)
                      ?.scrollIntoView({ block: 'nearest' })
                  } else if (event.key === 'Enter' && filtered[active]) {
                    event.preventDefault()
                    void choose(filtered[active])
                  }
                }}
              />
            </div>
            {selectedAgent && mode !== 'agents' && activeProvider === selectedAgent.provider && (
              <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-accent/30 px-2 py-1.5">
                <span className="min-w-0 truncate text-xs text-muted-foreground">
                  For {selectedAgent.name}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 px-2 text-xs"
                  disabled={disabled}
                  onClick={async () => {
                    if (await onUseHarness(activeProvider)) setOpen(false)
                  }}
                >
                  Use {providers[activeProvider].short} directly
                </Button>
              </div>
            )}
            <div
              id={listId}
              role="listbox"
              aria-label={mode === 'agents' ? 'Custom agents' : 'Models'}
              className="min-h-0 flex-1 overflow-y-auto"
            >
              {filtered.map((item, index) => {
                const key = `${item.agent ? 'agent' : item.provider}:${item.id}`
                const favorite = favorites.includes(key)
                const selected = item.agent
                  ? item.agent.id === selectedAgent?.id
                  : item.provider === value.provider && item.id === value.model
                return (
                  <div
                    key={key}
                    className={cn(
                      'group/model flex items-center rounded-lg',
                      selected ? 'bg-accent' : index === active && 'bg-accent/40',
                    )}
                  >
                    <button
                      type="button"
                      role="option"
                      aria-selected={selected}
                      id={`${listId}-${index}`}
                      data-value={item.id}
                      className="min-w-0 flex-1 px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onMouseEnter={() => setActive(index)}
                      onClick={() => void choose(item)}
                    >
                      <span className="flex items-center gap-2 text-sm">
                        {item.agent && (
                          <AgentAvatar
                            provider={item.provider}
                            customIcon={item.agent.icon ?? 'bot'}
                          />
                        )}
                        <span className="truncate">{item.name}</span>
                        {selected && <Check className="size-3 shrink-0" />}
                      </span>
                      <span className="mt-1 flex items-center gap-1.5 truncate text-xs text-muted-foreground">
                        <HarnessIcon provider={item.provider} className="size-3" />
                        {providers[item.provider].short}
                        {item.agent && ` · ${item.agent.model || 'Default model'}`}
                      </span>
                    </button>
                    {!item.agent && (
                      <button
                        type="button"
                        aria-label={`${favorite ? 'Unfavorite' : 'Favorite'} ${item.name}`}
                        aria-pressed={favorite}
                        className="mr-2 rounded p-1 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={() => {
                          const next = favorite
                            ? favorites.filter((value) => value !== key)
                            : [...favorites, key]
                          setFavorites(next)
                          try {
                            localStorage.setItem(favoritesKey, next.join('\n'))
                            setStorageError('')
                          } catch {
                            setStorageError('Favorites could not be saved on this device.')
                          }
                        }}
                      >
                        <Star className={cn('size-3.5', favorite && 'fill-current')} />
                      </button>
                    )}
                  </div>
                )
              })}
              {!filtered.length && (
                <p className="p-6 text-center text-xs text-muted-foreground">
                  {mode === 'agents'
                    ? agents.length
                      ? 'No matching custom agents.'
                      : 'Create custom agents in Settings → Agents.'
                    : mode === 'favorites'
                      ? 'Star models to keep them here.'
                      : 'No models found.'}
                </p>
              )}
              {mode === 'models' && catalog?.models.some((model) => model.hidden) && (
                <Button
                  type="button"
                  variant="ghost"
                  className="w-full justify-between text-xs"
                  onClick={() => setLegacy(!legacy)}
                >
                  Legacy models
                  <ChevronDown className={cn('size-3', legacy && 'rotate-180')} />
                </Button>
              )}
            </div>
            {lockedProvider && (
              <p className="px-2 pt-2 text-[11px] text-muted-foreground">
                This conversation uses {providers[lockedProvider].short}. Choose models or custom
                agents using the same provider.
              </p>
            )}
            {loading && mode === 'models' && (
              <p role="status" className="p-2 text-xs text-muted-foreground">
                Loading provider models…
              </p>
            )}
            {((mode === 'models' && error) || storageError) && (
              <p role="alert" className="p-2 text-xs text-destructive">
                {(mode === 'models' && error) || storageError}
              </p>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
