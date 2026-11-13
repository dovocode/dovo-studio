import { useApplicationState } from '@dovo/studio-core/state'
import { resourceError } from './error'
import {
  skillPackageSchema,
  catalogSortOptions,
  sortCatalogEntries,
  skillInstallLabel,
  mcpRegistrySources,
  registrySignals,
  type SkillPackage,
} from '@dovo/protocol'
import { useEffect, useRef } from 'react'
import {
  managedSkillSchema,
  registryCatalogSchema,
  skillCatalogSchema,
  useWorkspace,
  useAppPreferences,
  updateAppPreferences,
  type McpServer,
  type ManagedSkill,
  type RegistryEntry,
  type SkillCatalogEntry,
} from '@dovo/studio-core'
import { ArrowLeft } from 'lucide-react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@dovo/studio-ui'
export function CatalogPicker({
  kind,
  scope,
  onClose,
  onServer,
  onSkill,
  onSkills,
}: {
  kind: 'mcp' | 'skill'
  scope: string
  onClose: () => void
  onServer: (server: McpServer, notes: string[]) => void
  onSkill: (skill: ManagedSkill) => void
  onSkills: (skills: ManagedSkill[]) => Promise<void>
}) {
  const { request } = useWorkspace()
  const [query, setQuery] = useApplicationState('')
  const { mcpRegistrySource: source } = useAppPreferences()
  const setSource = (mcpRegistrySource: typeof source) =>
    updateAppPreferences({ mcpRegistrySource })
  const [view, setView] = useApplicationState('search')
  const [reload, setReload] = useApplicationState(0)
  const [sort, setSort] = useApplicationState('provider')
  const [detailsLoading, setDetailsLoading] = useApplicationState(false)
  const [servers, setServers] = useApplicationState<RegistryEntry[]>([])
  const [skills, setSkills] = useApplicationState<SkillCatalogEntry[]>([])
  const [cursor, setCursor] = useApplicationState<string | undefined>(undefined)
  const [selected, setSelected] = useApplicationState<RegistryEntry | undefined>(undefined)
  const [variantId, setVariantId] = useApplicationState('')
  const [loading, setLoading] = useApplicationState(false)
  const [importing, setImporting] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const [bundle, setBundle] = useApplicationState<(SkillPackage & { skill: string }) | null>(null)
  const [chosen, setChosen] = useApplicationState<string[]>([])
  const generation = useRef(0)
  useEffect(() => {
    const id = ++generation.current
    setError('')
    setCursor(undefined)
    setServers([])
    setSkills([])
    if (kind === 'skill' && view === 'search' && query.trim().length < 2) {
      setLoading(false)
      return
    }
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        if (kind === 'mcp') {
          const result = await request(
            '/api/agents/catalogs/mcp',
            {
              query,
              source,
            },
            registryCatalogSchema,
          )
          if (source !== 'official' && result.source !== source)
            throw new Error('Update this computer’s runtime to use this MCP registry.')
          if (id === generation.current) {
            setServers(result.entries)
            setCursor(result.cursor)
          }
        } else {
          const result = await request(
            '/api/agents/catalogs/skills',
            {
              query: view === 'search' ? query : '',
              view,
            },
            skillCatalogSchema,
          )
          if (view !== 'search' && result.view !== view)
            throw new Error('Update this computer’s runtime to browse skill leaderboards.')
          if (id === generation.current) {
            setSkills(result.entries)
            setCursor(result.cursor)
          }
        }
      } catch (error) {
        if (id === generation.current) setError(resourceError(error))
      } finally {
        if (id === generation.current) setLoading(false)
      }
    }, 300)
    return () => {
      clearTimeout(timer)
      ++generation.current
    }
  }, [kind, query, source, view, reload, request])
  const more = async () => {
    const id = generation.current
    setLoading(true)
    setError('')
    try {
      if (kind === 'mcp') {
        const result = await request(
          '/api/agents/catalogs/mcp',
          { query, source, cursor },
          registryCatalogSchema,
        )
        if (source !== 'official' && result.source !== source)
          throw new Error('Update this computer’s runtime to use this MCP registry.')
        if (id === generation.current) {
          setServers((entries) => [
            ...new Map(
              [...entries, ...result.entries].map((entry) => [
                entry.providerId ?? entry.name,
                entry,
              ]),
            ).values(),
          ])
          setCursor(result.cursor)
        }
      } else {
        const result = await request(
          '/api/agents/catalogs/skills',
          { query: view === 'search' ? query : '', view, cursor },
          skillCatalogSchema,
        )
        if (view !== 'search' && result.view !== view)
          throw new Error('Update this computer’s runtime to browse skill leaderboards.')
        if (id === generation.current) {
          setSkills((entries) => [
            ...new Map(
              [...entries, ...result.entries].map((entry) => [
                `${entry.source}/${entry.id}`,
                entry,
              ]),
            ).values(),
          ])
          setCursor(result.cursor)
        }
      }
    } catch (error) {
      if (id === generation.current) setError(resourceError(error))
    } finally {
      if (id === generation.current) setLoading(false)
    }
  }
  const selectServer = async (entry: RegistryEntry) => {
    setSelected(entry)
    setVariantId((entry.variants.find((item) => item.server) ?? entry.variants[0])?.id ?? '')
    if (entry.provider !== 'smithery') return
    const id = generation.current
    setDetailsLoading(true)
    setError('')
    try {
      const result = await request(
        '/api/agents/catalogs/mcp',
        { query: '', source: 'smithery', server: entry.providerId },
        registryCatalogSchema,
      )
      if (result.source !== 'smithery')
        throw new Error('Update this computer’s runtime to use Smithery.')
      if (id !== generation.current) return
      const detail = result.entries[0]
      if (!detail) throw new Error('The registry did not return this server.')
      setSelected({ ...entry, variants: detail.variants })
      setVariantId((detail.variants.find((item) => item.server) ?? detail.variants[0])?.id ?? '')
    } catch (cause) {
      if (id === generation.current) setError(resourceError(cause))
    } finally {
      if (id === generation.current) setDetailsLoading(false)
    }
  }
  const install = async (entry: SkillCatalogEntry) => {
    setImporting(true)
    setError('')
    try {
      onSkill(
        await request(
          '/api/agents/catalogs/skills/import',
          {
            source: entry.source,
            skill: entry.id,
          },
          managedSkillSchema,
        ),
      )
    } catch (error) {
      setError(resourceError(error))
    } finally {
      setImporting(false)
    }
  }
  const variant = selected?.variants.find((item) => item.id === variantId)
  const previewPackage = async (entry: SkillCatalogEntry) => {
    setImporting(true)
    setError('')
    try {
      const result = await request(
        '/api/agents/catalogs/skills/package/preview',
        { source: entry.source, skill: entry.id },
        skillPackageSchema,
      )
      setBundle({ ...result, skill: entry.id })
      setChosen(result.skills.length <= 20 ? result.skills.map((skill) => skill.name) : [entry.id])
    } catch (error) {
      setError(resourceError(error))
    } finally {
      setImporting(false)
    }
  }
  const installPackage = async () => {
    if (!bundle) return
    setImporting(true)
    setError('')
    try {
      const result = await request(
        '/api/agents/catalogs/skills/package/import',
        { source: bundle.source, skill: bundle.skill, revision: bundle.revision, skills: chosen },
        skillPackageSchema,
      )
      await onSkills(result.skills)
    } catch (error) {
      setError(resourceError(error))
    } finally {
      setImporting(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !importing) onClose()
      }}
    >
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {bundle ? 'Install skill package' : kind === 'mcp' ? 'MCP Registry' : 'skills.sh'}
          </DialogTitle>
          <DialogDescription>
            Pick an entry to add at {scope}. You can review and edit it before saving.
          </DialogDescription>
        </DialogHeader>
        {bundle ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <Button
              variant="ghost"
              size="sm"
              className="justify-self-start"
              disabled={importing}
              onClick={() => setBundle(null)}
            >
              Back to results
            </Button>
            <p className="text-xs text-muted-foreground">
              {bundle.source} · {bundle.revision.slice(0, 12)}. Includes scripts, references and
              assets. Matching saved skill names will be replaced.
            </p>
            <div className="min-h-0 space-y-2 overflow-y-auto">
              {bundle.skills.map((skill) => (
                <label key={skill.name} className="flex items-start gap-3 rounded-lg border p-3">
                  <input
                    type="checkbox"
                    checked={chosen.includes(skill.name)}
                    disabled={importing || (!chosen.includes(skill.name) && chosen.length >= 20)}
                    onChange={(event) =>
                      setChosen(
                        event.target.checked
                          ? [...chosen, skill.name]
                          : chosen.filter((name) => name !== skill.name),
                      )
                    }
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{skill.name}</span>
                    <span className="block text-xs text-muted-foreground">{skill.description}</span>
                  </span>
                </label>
              ))}
            </div>
            <Button disabled={importing || !chosen.length} onClick={() => void installPackage()}>
              {importing
                ? 'Installing…'
                : `Install ${chosen.length} ${chosen.length === 1 ? 'skill' : 'skills'}`}
            </Button>
          </div>
        ) : selected ? (
          <div className="grid gap-4 overflow-y-auto">
            <Button
              variant="ghost"
              size="sm"
              className="justify-self-start"
              disabled={detailsLoading}
              onClick={() => setSelected(undefined)}
            >
              <ArrowLeft className="size-3.5" />
              Back to results
            </Button>
            <div>
              <h3 className="text-sm font-medium break-all">{selected.name}</h3>
              <p className="mt-2 text-xs text-muted-foreground">{selected.description}</p>
              <a className="text-xs underline" href={selected.url} target="_blank" rel="noreferrer">
                {selected.provider === 'glama'
                  ? 'View on Glama'
                  : selected.provider === 'smithery'
                    ? 'View on Smithery'
                    : 'Registry entry'}{' '}
                {selected.version}
              </a>
            </div>
            <div className="space-y-1 text-xs text-muted-foreground">
              {registrySignals(selected).map((signal) => (
                <p key={signal}>{signal}</p>
              ))}
            </div>
            {detailsLoading ? (
              <p role="status" className="text-xs">
                Loading configuration…
              </p>
            ) : selected.variants.length ? (
              <>
                <Select value={variantId} onValueChange={setVariantId}>
                  <SelectTrigger aria-label="Installation variant" className="h-9 text-xs">
                    <SelectValue placeholder="Choose how to run this server" />
                  </SelectTrigger>
                  <SelectContent>
                    {selected.variants.map((item) => (
                      <SelectItem key={item.id} value={item.id}>
                        {item.label}
                        {item.server ? '' : ' · Not supported'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <ul className="space-y-2 text-xs text-muted-foreground">
                  {variant?.notes.map((note, i) => (
                    <li key={i}>{note}</li>
                  ))}
                </ul>
                <Button
                  disabled={!variant?.server}
                  onClick={() => {
                    if (variant?.server) onServer(variant.server, variant.notes)
                  }}
                >
                  Configure server
                </Button>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Open the provider listing for setup instructions, then add the MCP configuration
                manually.
              </p>
            )}
          </div>
        ) : (
          <>
            {kind === 'mcp' ? (
              <Select
                disabled={importing}
                value={source}
                onValueChange={(value) => {
                  const option = mcpRegistrySources.find((item) => item.id === value)
                  if (option) {
                    setSource(option.id)
                    setSort('provider')
                  }
                }}
              >
                <SelectTrigger aria-label="MCP registry source">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {mcpRegistrySources.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Select
                disabled={importing}
                value={view}
                onValueChange={(value) => {
                  setView(value)
                  setSort('provider')
                }}
              >
                <SelectTrigger aria-label="Browse skills">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[
                    { id: 'search', name: 'Search' },
                    { id: 'all-time', name: 'All time' },
                    { id: 'trending', name: 'Trending (24h)' },
                    { id: 'hot', name: 'Hot' },
                  ].map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={sort} onValueChange={setSort}>
              <SelectTrigger aria-label="Sort loaded results">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {catalogSortOptions[kind]
                  .filter((item) => item.id !== 'updated' || source === 'official')
                  .filter((item) => item.id !== 'uses' || source === 'smithery')
                  .filter((item) => item.id !== 'quality' || source === 'glama')
                  .map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Sorting applies to loaded results. Popularity does not establish safety.
            </p>
            {kind === 'mcp' && source === 'glama' && (
              <a
                className="text-xs underline"
                href="https://glama.ai/mcp/servers"
                target="_blank"
                rel="noreferrer"
              >
                MCP data from Glama
              </a>
            )}
            <Input
              autoFocus
              aria-label="Search catalog"
              placeholder={kind === 'mcp' ? 'Search MCP servers…' : 'Search skills.sh…'}
              value={query}
              disabled={importing || (kind === 'skill' && view !== 'search')}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="min-h-40 space-y-2 overflow-y-auto">
              {sortCatalogEntries(servers, sort).map((entry) => (
                <div key={entry.providerId ?? entry.name}>
                  <button
                    type="button"
                    className="w-full rounded-lg border p-3 text-left hover:bg-muted"
                    onClick={() => void selectServer(entry)}
                  >
                    <p className="text-sm font-medium break-all">{entry.name}</p>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {entry.description}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      {entry.version} · {entry.variants.filter((item) => item.server).length}{' '}
                      supported variants
                    </p>
                    {registrySignals(entry).map((signal) => (
                      <p key={signal} className="text-xs text-muted-foreground">
                        {signal}
                      </p>
                    ))}
                    <span className="text-xs underline">Review server</span>
                  </button>
                  <a
                    className="text-xs underline"
                    href={entry.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {entry.provider === 'glama'
                      ? 'View on Glama'
                      : entry.provider === 'smithery'
                        ? 'View on Smithery'
                        : 'View registry entry'}
                  </a>
                </div>
              ))}
              {sortCatalogEntries(skills, sort).map((entry) => (
                <div
                  key={`${entry.source}/${entry.id}`}
                  className="flex items-center gap-3 rounded-lg border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium break-words">{entry.name}</p>
                    <a
                      className="text-xs text-muted-foreground underline"
                      href={entry.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {entry.source}
                    </a>
                    <p className="mt-1 text-xs text-muted-foreground">{skillInstallLabel(entry)}</p>
                    <p className="text-xs text-muted-foreground">
                      Safety not assessed by Dovo.{' '}
                      <a className="underline" href={entry.url} target="_blank" rel="noreferrer">
                        Review published security audits
                      </a>
                    </p>
                    {!entry.supported && (
                      <p className="text-xs text-muted-foreground">Import this source manually.</p>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={importing || !entry.supported}
                    onClick={() => void previewPackage(entry)}
                  >
                    Install package
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={importing || !entry.supported}
                    onClick={() => void install(entry)}
                  >
                    Import skill
                  </Button>
                </div>
              ))}
              {!loading && !servers.length && !skills.length && (
                <p role="status" className="py-6 text-center text-xs text-muted-foreground">
                  {kind === 'skill' && view === 'search' && query.trim().length < 2
                    ? 'Type at least two characters to search skills.sh.'
                    : kind === 'mcp' &&
                        source === 'official' &&
                        query.trim().length > 0 &&
                        query.trim().length < 3
                      ? 'Type at least three characters to search the official registry.'
                      : error
                        ? 'The catalog could not be loaded.'
                        : 'No matching entries.'}
                </p>
              )}
              {loading && (
                <p role="status" className="py-3 text-xs text-muted-foreground">
                  Searching…
                </p>
              )}
              {cursor && (
                <Button variant="outline" disabled={loading} onClick={() => void more()}>
                  Load more
                </Button>
              )}
            </div>
          </>
        )}
        {importing && (
          <p role="status" className="text-xs text-muted-foreground">
            Importing skill and supporting files…
          </p>
        )}
        {error && !selected && !bundle && (
          <Button
            variant="outline"
            disabled={loading || importing}
            onClick={() => setReload((value) => value + 1)}
          >
            Retry catalog
          </Button>
        )}
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
