import { CredentialEditor } from './credential-editor'
import {
  credentialFields,
  credentialValues,
  ValidationError,
  safeValidationIssues,
  RuntimeRequestError,
} from '@dovo/protocol'
import { useApplicationState } from '@dovo/studio-core/state'
import { decode } from '@dovo/protocol'
import { resourceError } from './error'
import {
  mcpServerSchema,
  mcpTestResultSchema,
  useWorkspace,
  type McpServer,
} from '@dovo/studio-core'
import {
  Button,
  ChoicePicker,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  FormField,
  Input,
  Textarea,
} from '@dovo/studio-ui'
function bindings(text: string) {
  const result: Record<string, string> = {}
  for (const line of text.split('\n').filter((line) => line.trim())) {
    const parts = line.split('=').map((part) => part.trim())
    if (parts.length !== 2 || !parts[0] || !parts[1] || Object.hasOwn(result, parts[0]))
      throw new Error('Use one unique NAME=RUNTIME_ENV_NAME binding per line')
    result[parts[0]] = parts[1]
  }
  return result
}
const lines = (value: Record<string, string>) =>
  Object.entries(value)
    .map(([key, value]) => `${key}=${value}`)
    .join('\n')
export function McpEditor({
  initial,
  notes,
  scope,
  onSave,
  onClose,
}: {
  notes?: string[]
  initial?: McpServer
  scope: string
  onSave: (server: McpServer) => Promise<void>
  onClose: () => void
}) {
  const { request } = useWorkspace()
  const [draft, setDraft] = useApplicationState<McpServer>(
    initial ?? {
      name: '',
      enabled: true,
      transport: 'stdio',
      command: '',
      args: [],
      url: '',
      env: {},
      headerEnv: {},
      bearerTokenEnv: '',
    },
  )
  const [args, setArgs] = useApplicationState(initial?.args.join('\n') ?? '')
  const [env, setEnv] = useApplicationState(lines(initial?.env ?? {}))
  const [headers, setHeaders] = useApplicationState(lines(initial?.headerEnv ?? {}))
  const [envValues, setEnvValues] = useApplicationState(credentialFields(initial?.envValues ?? {}))
  const [headerValues, setHeaderValues] = useApplicationState(
    credentialFields(initial?.headerValues ?? {}),
  )
  const [busy, setBusy] = useApplicationState(false)
  const [error, setError] = useApplicationState('')
  const [issues, setIssues] = useApplicationState<readonly { path: string; message: string }[]>([])
  const fieldError = (path: string) => issues.find((issue) => issue.path === path)?.message
  const [result, setResult] = useApplicationState('')
  const perform = async (test: boolean) => {
    setBusy(true)
    setError('')
    setIssues([])
    setResult('')
    try {
      const server = decode(mcpServerSchema, {
        ...draft,
        args: args.split('\n').filter(Boolean),
        env: bindings(env),
        headerEnv: bindings(headers),
        envValues: credentialValues(envValues),
        headerValues: credentialValues(headerValues),
      })
      if ([server.url, ...server.args].some((value) => value.includes('__CONFIGURE_')))
        throw new Error('Replace the __CONFIGURE_…__ placeholders before saving or testing.')
      if (test) {
        const response = await request('/api/agents/mcp/test', server, mcpTestResultSchema)
        setResult(
          `Connected to ${response.server} · ${response.tools.length} tools${response.tools.length ? `: ${response.tools.join(', ')}` : ''}`,
        )
      } else await onSave(server)
    } catch (error) {
      setIssues(
        error instanceof ValidationError
          ? safeValidationIssues(error)
          : error instanceof RuntimeRequestError
            ? (error.issues ?? [])
            : [],
      )
      setError(resourceError(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? 'Edit MCP server' : 'Add MCP server'}</DialogTitle>
          <DialogDescription>{scope}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void perform(false)
          }}
        >
          <fieldset disabled={busy} className="grid gap-4">
            {initial?.sourceUrl && (
              <a
                className="text-xs underline"
                href={initial.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                Registry source · {initial.sourceRevision}
              </a>
            )}
            {!!notes?.length && (
              <ul className="space-y-1 text-xs text-muted-foreground">
                {notes.map((note, i) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            )}
            <FormField label="Name" error={fieldError('name')}>
              <Input
                required
                value={draft.name}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    name: event.target.value,
                  })
                }
              />
            </FormField>
            <FormField label="Transport">
              <ChoicePicker
                aria-label="Transport"
                value={draft.transport}
                onValueChange={(value) =>
                  setDraft({
                    ...draft,
                    transport: value === 'http' ? 'http' : 'stdio',
                  })
                }
              >
                <option value="stdio">Local command (stdio)</option>
                <option value="http">Streamable HTTP</option>
              </ChoicePicker>
            </FormField>
            {draft.transport === 'stdio' ? (
              <>
                <FormField label="Executable" error={fieldError('command')}>
                  <Input
                    required
                    placeholder="npx"
                    value={draft.command}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        command: event.target.value,
                      })
                    }
                  />
                </FormField>
                <FormField label="Arguments (one per line)">
                  <Textarea value={args} onChange={(event) => setArgs(event.target.value)} />
                </FormField>
                <FormField label="Environment bindings">
                  <Textarea
                    placeholder="API_KEY=MY_API_KEY"
                    value={env}
                    onChange={(event) => setEnv(event.target.value)}
                  />
                </FormField>
              </>
            ) : (
              <>
                <FormField label="Server URL" error={fieldError('url')}>
                  <Input
                    required
                    type="url"
                    placeholder="https://example.com/mcp"
                    value={draft.url}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        url: event.target.value,
                      })
                    }
                  />
                </FormField>
                <FormField
                  label="Bearer token environment variable"
                  error={fieldError('bearerTokenEnv')}
                >
                  <Input
                    placeholder="MY_API_TOKEN"
                    value={draft.bearerTokenEnv}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        bearerTokenEnv: event.target.value,
                      })
                    }
                  />
                </FormField>
                <FormField label="Header bindings">
                  <Textarea
                    placeholder="X-API-Key=MY_API_KEY"
                    value={headers}
                    onChange={(event) => setHeaders(event.target.value)}
                  />
                </FormField>
              </>
            )}
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground">
                Values stored on the runtime
              </summary>
              <FormField
                label={
                  draft.transport === 'stdio' ? 'Environment credentials' : 'Header credentials'
                }
              >
                <CredentialEditor
                  fields={draft.transport === 'stdio' ? envValues : headerValues}
                  onChange={draft.transport === 'stdio' ? setEnvValues : setHeaderValues}
                  disabled={busy}
                />
              </FormField>
            </details>
            <p className="text-xs text-muted-foreground">
              Bindings reference environment variables on the runtime host. Testing starts the
              server and lists tools without calling them.
            </p>
            {error && (
              <p role="alert" className="text-xs text-destructive whitespace-pre-wrap">
                {error}
              </p>
            )}
            {result && (
              <p role="status" className="text-xs break-words">
                {result}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => void perform(true)}>
                Test connection
              </Button>
              <Button type="submit">{busy ? 'Working…' : 'Save server'}</Button>
            </div>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  )
}
