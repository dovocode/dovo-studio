import { resourceError } from './error'
import { useEffect, useRef, useState } from 'react'
import {
  managedSkillSchema,
  registryCatalogSchema,
  skillCatalogSchema,
  useWorkspace,
  type McpServer,
  type ManagedSkill,
  type RegistryEntry,
  type SkillCatalogEntry,
} from '@dovo/studio-core'
import {
  Button,
  ChoicePicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
} from '@dovo/studio-ui'
export function CatalogPicker({
  kind,
  scope,
  onClose,
  onServer,
  onSkill,
}: {
  kind: 'mcp' | 'skill'
  scope: string
  onClose: () => void
  onServer: (server: McpServer, notes: string[]) => void
  onSkill: (skill: ManagedSkill) => void
}) {
  const { request } = useWorkspace()
  const [query, setQuery] = useState('')
  const [servers, setServers] = useState<RegistryEntry[]>([])
  const [skills, setSkills] = useState<SkillCatalogEntry[]>([])
  const [cursor, setCursor] = useState<string>()
  const [selected, setSelected] = useState<RegistryEntry>()
  const [variantId, setVariantId] = useState('')
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const generation = useRef(0)
  useEffect(() => {
    const id = ++generation.current
    setError('')
    setCursor(undefined)
    setServers([])
    setSkills([])
    if (kind === 'skill' && query.trim().length < 2) {
      setLoading(false)
      return
    }
    setLoading(true)
    const timer = setTimeout(async () => {
      try {
        if (kind === 'mcp') {
          const result = await request('/api/agents/catalogs/mcp', { query }, registryCatalogSchema)
          if (id === generation.current) {
            setServers(result.entries)
            setCursor(result.cursor)
          }
        } else {
          const result = await request('/api/agents/catalogs/skills', { query }, skillCatalogSchema)
          if (id === generation.current) setSkills(result.entries)
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
  }, [kind, query, request])
  const more = async () => {
    const id = generation.current
    setLoading(true)
    setError('')
    try {
      const result = await request(
        '/api/agents/catalogs/mcp',
        { query, cursor },
        registryCatalogSchema,
      )
      if (id === generation.current) {
        setServers((entries) => [
          ...new Map([...entries, ...result.entries].map((entry) => [entry.name, entry])).values(),
        ])
        setCursor(result.cursor)
      }
    } catch (error) {
      if (id === generation.current) setError(resourceError(error))
    } finally {
      if (id === generation.current) setLoading(false)
    }
  }
  const install = async (entry: SkillCatalogEntry) => {
    setImporting(true)
    setError('')
    try {
      onSkill(
        await request(
          '/api/agents/catalogs/skills/import',
          { source: entry.source, skill: entry.id },
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
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !importing) onClose()
      }}
    >
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{kind === 'mcp' ? 'MCP Registry' : 'skills.sh'}</DialogTitle>
          <DialogDescription>{scope} · Review before saving</DialogDescription>
        </DialogHeader>
        {selected ? (
          <div className="grid gap-4 overflow-y-auto">
            <Button
              variant="ghost"
              className="justify-self-start"
              onClick={() => setSelected(undefined)}
            >
              ← Search results
            </Button>
            <div>
              <h3 className="text-sm font-medium break-all">{selected.name}</h3>
              <p className="mt-2 text-xs text-muted-foreground">{selected.description}</p>
              <a className="text-xs underline" href={selected.url} target="_blank" rel="noreferrer">
                Registry entry · {selected.version}
              </a>
            </div>
            {selected.variants.length ? (
              <>
                <ChoicePicker
                  aria-label="Installation variant"
                  value={variantId}
                  onValueChange={setVariantId}
                >
                  {selected.variants.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </ChoicePicker>
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
                No installation variants are published for this entry.
              </p>
            )}
          </div>
        ) : (
          <>
            <Input
              autoFocus
              aria-label="Search catalog"
              placeholder={kind === 'mcp' ? 'Search MCP servers…' : 'Search skills.sh…'}
              value={query}
              disabled={importing}
              onChange={(event) => setQuery(event.target.value)}
            />
            <div className="min-h-40 space-y-2 overflow-y-auto">
              {servers.map((entry) => (
                <button
                  key={entry.name}
                  type="button"
                  className="w-full rounded-lg border p-3 text-left hover:bg-muted"
                  onClick={() => {
                    setSelected(entry)
                    setVariantId(
                      (entry.variants.find((item) => item.server) ?? entry.variants[0])?.id ?? '',
                    )
                  }}
                >
                  <p className="text-sm font-medium break-all">{entry.name}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {entry.description}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {entry.version} · {entry.variants.filter((item) => item.server).length}{' '}
                    supported variants
                  </p>
                </button>
              ))}
              {skills.map((entry) => (
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
                    <p className="mt-1 text-xs text-muted-foreground">
                      {entry.installs.toLocaleString()} installs
                    </p>
                    {!entry.supported && (
                      <p className="text-xs text-muted-foreground">Import this source manually.</p>
                    )}
                  </div>
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
                <p className="py-6 text-center text-xs text-muted-foreground">
                  {kind === 'skill' && query.trim().length < 2
                    ? 'Type at least two characters to search skills.sh.'
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
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
