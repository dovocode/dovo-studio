import { useApplicationState } from '@dovo/studio-core/state'
import { useEffect, useId } from 'react'
import { Bot, Check, ChevronDown, Search, Star, Eye, EyeOff, Settings2 } from 'lucide-react'
import {
  defaultTaskHarness,
  providers,
  providerSchema,
  acpInstallationHarness,
  acpHarnessName,
  useWorkspace,
  type Agent,
  type TaskHarness,
} from '@dovo/studio-core'
import { AgentAvatar } from './agent-avatar'
import { Button } from './components/ui/button'
import { Input } from './components/ui/input'
import * as Popover from '@radix-ui/react-popover'
import { cn } from './lib/utils'
import { HarnessIcon } from './harness-icon'
import { useHarnessCatalog } from './harness-catalog'
import { modelPreferenceKey, runtimeDefaultsSchema, type RuntimeDefaults } from '@dovo/protocol'
const favoritesKey = 'dovo:model-favorites'
type PickerItem = {
  id: string
  name: string
  provider: TaskHarness['provider']
  hidden?: boolean
  agent?: Agent
  installationId?: string
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
  lockedInstallationId,
}: {
  agents: readonly Agent[]
  selectedAgent?: Agent
  onSelectAgent: (agentId: string) => Promise<boolean>
  onUseHarness: (harness: TaskHarness) => Promise<boolean>
  lockedProvider?: TaskHarness['provider']
  lockedInstallationId?: string
  value: TaskHarness
  disabled: boolean
  onChange: (next: TaskHarness) => Promise<boolean>
  onConfigure: () => void
}) {
  const { snapshot, request } = useWorkspace()
  const installations = snapshot?.acpInstallations ?? []
  const [open, setOpen] = useApplicationState(false)
  const [provider, setProvider] = useApplicationState(value.provider)
  const [installationId, setInstallationId] = useApplicationState(value.acpInstallationId)
  const [mode, setMode] = useApplicationState<'models' | 'favorites' | 'agents'>('models')
  const [query, setQuery] = useApplicationState('')
  const [active, setActive] = useApplicationState(0)
  const [legacy, setLegacy] = useApplicationState(false)
  const [legacyFavorites, setLegacyFavorites] = useApplicationState<string[]>(() => {
    try {
      return localStorage.getItem(favoritesKey)?.split('\n').filter(Boolean) ?? []
    } catch {
      return []
    }
  })
  const [storageError, setStorageError] = useApplicationState('')
  const [savedPreferences, setSavedPreferences] =
    useApplicationState<RuntimeDefaults['modelPreferences']>(undefined)
  const [manageModels, setManageModels] = useApplicationState(false)
  const snapshotPreferences = JSON.stringify(snapshot?.defaults?.modelPreferences ?? {})
  useEffect(() => setSavedPreferences(undefined), [snapshotPreferences])
  const preferences = savedPreferences ?? snapshot?.defaults?.modelPreferences ?? {}
  const favorites = [
    ...new Set([
      ...legacyFavorites.filter((key) => preferences[key]?.favorite !== false),
      ...Object.keys(preferences).filter((key) => preferences[key].favorite),
    ]),
  ]
  const itemKey = (item: PickerItem) =>
    item.agent
      ? `agent:${item.id}`
      : modelPreferenceKey(item.provider, item.id, item.installationId)
  const savePreference = async (
    key: string,
    change: { favorite?: boolean; disabled?: boolean },
  ) => {
    try {
      const result = await request(
        '/api/agents/models/preference',
        { key, ...change },
        runtimeDefaultsSchema,
      )
      setSavedPreferences(result.modelPreferences)
      if (change.favorite !== undefined) {
        const next = legacyFavorites.filter((entry) => entry !== key)
        setLegacyFavorites(next)
        localStorage.setItem(favoritesKey, next.join('\n'))
      }
      setStorageError('')
    } catch (error) {
      setStorageError(error instanceof Error ? error.message : String(error))
    }
  }
  const activeProvider = lockedProvider ?? provider
  const selectedHarness =
    activeProvider === value.provider &&
    (activeProvider !== 'acp' || installationId === value.acpInstallationId)
      ? value
      : activeProvider === 'acp' && installationId
        ? {
            ...defaultTaskHarness('acp'),
            acpInstallationId: installationId,
            permission: value.permission,
          }
        : { ...defaultTaskHarness(activeProvider), permission: value.permission }
  const { catalog, loading, error } = useHarnessCatalog(selectedHarness, open && mode === 'models')
  const selectedCatalog = useHarnessCatalog(value, true)
  const listId = useId()
  const items: PickerItem[] = !open
    ? []
    : mode === 'agents'
      ? agents.map((agent) => ({
          id: agent.id,
          name: agent.name,
          provider: agent.provider,
          hidden: false,
          agent,
        }))
      : mode === 'favorites'
        ? favorites.flatMap<PickerItem>((key) => {
            if (key.startsWith('agent:')) {
              const agent = agents.find((entry) => entry.id === key.slice(6))
              return agent
                ? [
                    {
                      id: agent.id,
                      name: agent.name,
                      provider: agent.provider,
                      agent,
                      hidden: false,
                    },
                  ]
                : []
            }
            const provider = providerSchema.literals.find((p) => key.startsWith(`${p}:`))
            const installation =
              provider === 'acp'
                ? installations.find((entry) => key.startsWith(`acp:${entry.id}:`))
                : undefined
            return provider
              ? [
                  {
                    id: key.slice(
                      installation ? `acp:${installation.id}:`.length : provider.length + 1,
                    ),
                    name:
                      key.slice(
                        installation ? `acp:${installation.id}:`.length : provider.length + 1,
                      ) || 'Provider default',
                    provider,
                    installationId: installation?.id,
                    hidden: false,
                  },
                ]
              : []
          })
        : [
            {
              id: '',
              name: 'Provider default',
              provider: activeProvider,
              installationId: selectedHarness.acpInstallationId,
              hidden: false,
            },
            ...(catalog?.models ?? []).map((model) => ({
              ...model,
              provider: activeProvider,
              installationId: selectedHarness.acpInstallationId,
            })),
            ...(query.trim() && !catalog?.models.some((m) => m.id === query.trim())
              ? [
                  {
                    id: query.trim(),
                    name: `Use custom model “${query.trim()}”`,
                    provider: activeProvider,
                    installationId: selectedHarness.acpInstallationId,
                    hidden: false,
                  },
                ]
              : []),
          ]
  const filtered = items.filter(
    (item) =>
      ((mode === 'models' && manageModels) || !preferences[itemKey(item)]?.disabled) &&
      (!lockedProvider || item.provider === lockedProvider) &&
      (lockedInstallationId === undefined ||
        (item.installationId ?? item.agent?.acpInstallationId ?? '') === lockedInstallationId) &&
      (legacy || !item.hidden || query.trim()) &&
      `${item.name} ${item.id} ${item.agent?.model ?? ''} ${providers[item.provider].short}`
        .toLowerCase()
        .includes(query.toLowerCase().trim()),
  )
  filtered.sort(
    (a, b) => Number(favorites.includes(itemKey(b))) - Number(favorites.includes(itemKey(a))),
  )
  const choose = async (item: (typeof items)[number]) => {
    if (
      disabled ||
      preferences[itemKey(item)]?.disabled ||
      (lockedProvider && item.provider !== lockedProvider) ||
      (lockedInstallationId !== undefined &&
        (item.installationId ?? item.agent?.acpInstallationId ?? '') !== lockedInstallationId)
    )
      return
    if (item.agent) {
      if (await onSelectAgent(item.agent.id)) setOpen(false)
      return
    }
    const sameHarness =
      item.provider === value.provider &&
      (item.provider !== 'acp' || item.installationId === value.acpInstallationId)
    const installation = installations.find((entry) => entry.id === item.installationId)
    const base = sameHarness
      ? value
      : installation
        ? acpInstallationHarness(installation, value.permission)
        : item.provider === activeProvider
          ? selectedHarness
          : { ...defaultTaskHarness(item.provider), permission: value.permission }
    const saved = await onChange({
      ...base,
      model: item.id,
      reasoning: item.id === value.model && sameHarness ? value.reasoning : '',
      cyberAccessProgram:
        item.id === value.model && sameHarness ? value.cyberAccessProgram : undefined,
      serviceTier: item.id === value.model && sameHarness ? value.serviceTier : undefined,
    })
    if (saved) setOpen(false)
  }
  return (
    <Popover.Root
      open={open && !disabled}
      onOpenChange={(next) => {
        setOpen(next)
        setProvider(value.provider)
        setInstallationId(value.acpInstallationId)
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
            {selectedCatalog.modelName ||
              value.model ||
              acpHarnessName(value, installations) ||
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
            className="flex w-12 shrink-0 flex-col items-center gap-1 overflow-y-auto border-r p-1.5"
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
              aria-label="Configurations"
              title="Configurations"
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
            {providerSchema.literals
              .filter(
                (p) =>
                  (!lockedProvider || p === lockedProvider) &&
                  (p !== 'acp' ||
                    lockedInstallationId === undefined ||
                    lockedInstallationId === ''),
              )
              .map((p) => (
                <Button
                  key={p}
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`${providers[p].short} models`}
                  aria-pressed={mode === 'models' && p === activeProvider && !installationId}
                  title={providers[p].short}
                  className={cn(
                    'size-9',
                    mode === 'models' &&
                      p === activeProvider &&
                      !installationId &&
                      'bg-accent text-primary ring-1 ring-inset ring-primary/50',
                  )}
                  onClick={() => {
                    setProvider(p)
                    setInstallationId(undefined)
                    setMode('models')
                    setActive(0)
                    setQuery('')
                  }}
                >
                  <HarnessIcon provider={p} className="size-4" />
                </Button>
              ))}
            {installations.length > 0 && (!lockedProvider || lockedProvider === 'acp') && (
              <div className="my-1 w-full border-t" />
            )}
            {installations
              .filter(
                (installation) =>
                  (!lockedProvider || lockedProvider === 'acp') &&
                  (lockedInstallationId === undefined || lockedInstallationId === installation.id),
              )
              .map((installation) => (
                <Button
                  key={installation.id}
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`${installation.name} models`}
                  aria-pressed={
                    mode === 'models' &&
                    activeProvider === 'acp' &&
                    installationId === installation.id
                  }
                  title={installation.name}
                  className={cn(
                    'size-9',
                    mode === 'models' &&
                      activeProvider === 'acp' &&
                      installationId === installation.id &&
                      'bg-accent text-primary ring-1 ring-inset ring-primary/50',
                  )}
                  onClick={() => {
                    setProvider('acp')
                    setInstallationId(installation.id)
                    setMode('models')
                    setActive(0)
                    setQuery('')
                  }}
                >
                  <span className="text-[10px] font-semibold uppercase">
                    {installation.name.slice(0, 2)}
                  </span>
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
                aria-label={mode === 'agents' ? 'Search configurations' : 'Search models'}
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={
                  filtered.length ? `${listId}-${Math.min(active, filtered.length - 1)}` : undefined
                }
                placeholder={mode === 'agents' ? 'Search configurations…' : 'Search models…'}
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
                    document.getElementById(`${listId}-${next}`)?.scrollIntoView({
                      block: 'nearest',
                    })
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
                    if (await onUseHarness(selectedHarness)) setOpen(false)
                  }}
                >
                  Use{' '}
                  {acpHarnessName(selectedHarness, installations) ??
                    providers[activeProvider].short}{' '}
                  directly
                </Button>
              </div>
            )}
            {mode === 'models' && (
              <Button
                size="sm"
                variant="ghost"
                aria-pressed={manageModels}
                onClick={() => setManageModels(!manageModels)}
              >
                {manageModels ? 'Done managing models' : 'Manage model visibility'}
              </Button>
            )}
            <div
              id={listId}
              role="listbox"
              aria-label={mode === 'agents' ? 'Configurations' : 'Models'}
              className="min-h-0 flex-1 overflow-y-auto"
            >
              {filtered.map((item, index) => {
                const key = itemKey(item)
                const favorite = favorites.includes(key)
                const selected = item.agent
                  ? item.agent.id === selectedAgent?.id
                  : item.provider === value.provider &&
                    item.id === value.model &&
                    (item.provider !== 'acp' || item.installationId === value.acpInstallationId)
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
                    {!item.agent && manageModels && (
                      <button
                        type="button"
                        aria-label={`${preferences[key]?.disabled ? 'Enable' : 'Disable'} ${item.name}`}
                        aria-pressed={!!preferences[key]?.disabled}
                        className="mr-2 rounded p-1 text-muted-foreground"
                        onClick={() =>
                          void savePreference(key, { disabled: !preferences[key]?.disabled })
                        }
                      >
                        {preferences[key]?.disabled ? (
                          <EyeOff className="size-3.5" />
                        ) : (
                          <Eye className="size-3.5" />
                        )}
                      </button>
                    )}
                    <button
                      type="button"
                      aria-label={`${favorite ? 'Unfavorite' : 'Favorite'} ${item.name}`}
                      aria-pressed={favorite}
                      className="mr-2 rounded p-1 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => void savePreference(key, { favorite: !favorite })}
                    >
                      <Star className={cn('size-3.5', favorite && 'fill-current')} />
                    </button>
                  </div>
                )
              })}
              {!filtered.length && (
                <p className="p-6 text-center text-xs text-muted-foreground">
                  {mode === 'agents'
                    ? agents.length
                      ? 'No matching configurations.'
                      : 'Create configurations in Settings → Agents.'
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
              <p className="px-2 pt-2 text-[0.6875rem] text-muted-foreground">
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
