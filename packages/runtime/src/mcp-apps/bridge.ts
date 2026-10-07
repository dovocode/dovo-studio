import { AppToolViews, appViewTools } from './views.js'
import { startPolling } from '@dovo/client-runtime'
import { runtimeOperation } from '../errors.js'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import type Database from 'better-sqlite3'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { mcpHttpOptions } from './http-transport.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import {
  McpError,
  ErrorCode,
  CallToolResultSchema,
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ToolListChangedNotificationSchema,
  ResourceListChangedNotificationSchema,
  PromptListChangedNotificationSchema,
  type Tool,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js'
import {
  decode,
  mcpServerSchema,
  mcpAppSchema,
  resolveTaskAgent,
  mergeResources,
  type McpServer,
  type Agent,
  type McpApp,
} from '@dovo/protocol'
import { mcpHeaders, mcpServerEnvironment } from '../agents/configuration/mcp-settings.js'
import type { WorkspaceStore } from '../storage/workspace.js'
import type { Activity } from '../storage/activity.js'
import type { Approvals } from '../agents/execution/approvals.js'
import { HttpError } from '../errors.js'
import {
  object,
  appUri,
  visibleTo,
  legacyResources,
  htmlResource,
  isAppMime,
  MAX_APP_BYTES,
} from './resources.js'

type Session = {
  client: Client
  transport: Transport
  tools: Tool[]
  key: string
  toolsDirty: boolean
  busy: number
  lastUsed: number
}
type Scope = {
  taskId: string
  server: McpServer
  cwd: string
  permission: Agent['permission']
  signal?: AbortSignal
}
type StoredApp = McpApp & { fingerprint: string; cwd: string }
const fingerprint = (server: McpServer) =>
  createHash('sha256').update(JSON.stringify(server)).digest('hex')
/** Owns upstream MCP connections; provider proxies never receive their credentials. */
export class McpApps {
  private views = new AppToolViews()
  private sessions = new Map<string, Promise<Session>>()
  private resolved = new Map<string, Session>()
  private polling?: ReturnType<typeof startPolling>
  start() {
    this.polling ??= startPolling(
      runtimeOperation(() => this.reconcile()),
      { interval: 60_000, onError: (error) => console.error('MCP cleanup failed', error.message) },
    )
  }
  private scopes = new Map<string, Scope>()
  private controller = new AbortController()
  private actions = new Map<
    string,
    { taskId: string; input: string; promise: Promise<unknown>; controller: AbortController }
  >()
  private stopped = false
  private sendMessage?: (taskId: string, messageId: string, text: string) => Promise<unknown>
  setSendMessage(send: (taskId: string, messageId: string, text: string) => Promise<unknown>) {
    this.sendMessage = send
  }
  context(taskId: string) {
    const rows = this.db
      .prepare('SELECT value FROM documents WHERE id LIKE ?')
      .all(`mcp-app-context:${taskId}:%`)
    return rows
      .slice(-8)
      .map((row) => object(row).value)
      .filter((value): value is string => typeof value === 'string')
      .join('\n')
      .slice(0, 64000)
  }
  constructor(
    private db: Database.Database,
    private store: WorkspaceStore,
    private activity: Activity,
    private approvals: Approvals,
  ) {
    db.exec(
      'CREATE TABLE IF NOT EXISTS mcp_apps (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, value TEXT NOT NULL); CREATE INDEX IF NOT EXISTS mcp_apps_task ON mcp_apps(task_id); CREATE TABLE IF NOT EXISTS mcp_app_actions (id TEXT PRIMARY KEY, input TEXT NOT NULL, state TEXT NOT NULL, result TEXT)',
    )
  }
  proxies(
    taskId: string,
    servers: McpServer[],
    cwd: string,
    permission: Agent['permission'],
    listener: { port: number; host: string },
    signal?: AbortSignal,
  ) {
    const host = listener.host === '0.0.0.0' || listener.host === '::' ? '127.0.0.1' : listener.host
    const adjacent = new URL('./proxy.js', import.meta.url)
    const script = existsSync(fileURLToPath(adjacent))
      ? adjacent
      : new URL('../../dist/mcp-apps/proxy.js', import.meta.url)
    return servers.map((server) => {
      if (!server.enabled || server.name === 'dovo_task') return server
      const previous = [...this.scopes.entries()].find(
        ([, scope]) =>
          scope.taskId === taskId &&
          fingerprint(scope.server) === fingerprint(server) &&
          scope.cwd === cwd &&
          scope.permission === permission,
      )
      const token = previous?.[0] ?? randomBytes(32).toString('base64url')
      this.scopes.set(token, { taskId, server, cwd, permission, signal })
      return decode(mcpServerSchema, {
        name: server.name,
        enabled: true,
        transport: 'stdio',
        command: process.execPath,
        args: [fileURLToPath(script)],
        envValues: {
          ELECTRON_RUN_AS_NODE: '1',
          DOVO_MCP_BRIDGE_TOKEN: token,
          DOVO_MCP_BRIDGE_URL: `http://${host.includes(':') ? `[${host}]` : host}:${listener.port}/api/mcp-apps/proxy`,
        },
      })
    })
  }
  private current(taskId: string, name: string): Scope {
    const task = this.store.task(taskId)
    const agent = resolveTaskAgent(task, this.store.get().agents)
    if (!agent) throw new HttpError(409, 'The thread no longer has an agent')
    const project = this.store.get().repositories.find((item) => item.id === task.repositoryId)
    const server = mergeResources(
      this.store.projectSettings(task.repositoryId).resources,
      agent.resources,
    ).mcpServers.find((entry) => entry.enabled && entry.name === name)
    if (!server) throw new HttpError(403, 'This MCP server is no longer enabled for the thread')
    const scope = [...this.scopes.values()].find(
      (entry) => entry.taskId === taskId && fingerprint(entry.server) === fingerprint(server),
    )
    // UI can reconnect saved apps after a runtime restart without starting another agent turn.
    const savedCwd = scope
      ? undefined
      : object(
          this.db
            .prepare(
              "SELECT json_extract(value, '$.cwd') AS cwd FROM mcp_apps WHERE task_id=? AND json_extract(value, '$.server')=? AND json_extract(value, '$.fingerprint')=? ORDER BY rowid DESC LIMIT 1",
            )
            .get(taskId, name, fingerprint(server)),
        ).cwd
    const cwd =
      scope?.cwd ??
      (typeof savedCwd === 'string' ? savedCwd : undefined) ??
      task.existingWorktreePath ??
      project?.path
    if (!cwd) throw new HttpError(409, 'The thread checkout is unavailable')
    return { taskId, server, cwd, permission: agent.permission }
  }
  private async connect(scope: Scope): Promise<Session> {
    if (this.stopped) throw new HttpError(503, 'MCP bridge is stopping')
    const key = `${scope.taskId}:${fingerprint(scope.server)}:${scope.cwd}`
    const cached = this.sessions.get(key)
    if (cached) return cached
    if (this.sessions.size >= 64) {
      const idle = [...this.resolved.values()]
        .filter((session) => !session.busy)
        .sort((a, b) => a.lastUsed - b.lastUsed)[0]
      if (!idle)
        throw new HttpError(429, 'All MCP connections are busy; try again when a tool finishes')
      this.sessions.delete(idle.key)
      this.resolved.delete(idle.key)
      await idle.client.close()
      await idle.transport.close()
    }
    const opening = (async () => {
      const client = new Client(
        { name: 'dovo-studio', version: '1.0.0' },
        {
          capabilities: {
            extensions: {
              'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] },
            },
          },
        },
      )
      const config = scope.server
      let transport: Transport =
        config.transport === 'stdio'
          ? new StdioClientTransport({
              command: config.command,
              args: config.args,
              env: {
                ...Object.fromEntries(
                  Object.entries(process.env).filter(
                    (entry): entry is [string, string] => typeof entry[1] === 'string',
                  ),
                ),
                ...mcpServerEnvironment(config),
              },
              cwd: scope.cwd,
              stderr: 'pipe',
            })
          : new StreamableHTTPClientTransport(
              new URL(config.url),
              mcpHttpOptions(mcpHeaders(config)),
            )
      if (transport instanceof StdioClientTransport) transport.stderr?.on('data', () => {})
      const timeout = AbortSignal.any([this.controller.signal, AbortSignal.timeout(30_000)])
      try {
        try {
          await client.connect(transport, { signal: timeout })
        } catch (error) {
          // Older MCP servers expose SSE, not Streamable HTTP. Do not retry auth failures.
          await transport.close()
          if (
            config.transport !== 'http' ||
            !(error instanceof StreamableHTTPError) ||
            ![404, 405, 406].includes(error.code ?? 0)
          )
            throw error
          transport = new SSEClientTransport(
            new URL(config.url),
            mcpHttpOptions(mcpHeaders(config)),
          )
          await client.connect(transport, { signal: timeout })
        }
        const tools: Tool[] = []
        let cursor: string | undefined
        const cursors = new Set<string>()
        if (client.getServerCapabilities()?.tools)
          do {
            const page = await client.listTools({ cursor }, { signal: timeout })
            tools.push(...page.tools)
            if (tools.length > 2000) throw new HttpError(413, 'MCP server exposes too many tools')
            cursor = page.nextCursor
            if (cursor && cursors.has(cursor))
              throw new HttpError(502, 'MCP server repeated its tool cursor')
            if (cursor) cursors.add(cursor)
          } while (cursor)
        client.onclose = () => {
          if (this.sessions.get(key) === opening) this.sessions.delete(key)
          this.resolved.delete(key)
        }
        const session = {
          client,
          transport,
          tools,
          key,
          toolsDirty: false,
          busy: 0,
          lastUsed: Date.now(),
        }
        this.resolved.set(key, session)
        client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
          session.toolsDirty = true
          this.changed(scope)
        })
        client.setNotificationHandler(ResourceListChangedNotificationSchema, () =>
          this.changed(scope),
        )
        client.setNotificationHandler(PromptListChangedNotificationSchema, () =>
          this.changed(scope),
        )
        return session
      } catch (error) {
        await client.close()
        await transport.close()
        throw error
      }
    })()
    this.sessions.set(key, opening)
    try {
      return await opening
    } catch (error) {
      if (this.sessions.get(key) === opening) this.sessions.delete(key)
      throw error
    }
  }
  async proxy(token: string, method: string, params: unknown) {
    const scope = this.scopes.get(token)
    if (!scope) throw new HttpError(401, 'Invalid MCP bridge credential')
    const current = this.current(scope.taskId, scope.server.name)
    if (
      fingerprint(current.server) !== fingerprint(scope.server) ||
      current.permission !== scope.permission
    )
      throw new HttpError(403, 'MCP configuration changed; start a new turn')
    return this.rpc(
      scope,
      method,
      params,
      false,
      scope.signal
        ? AbortSignal.any([scope.signal, this.controller.signal])
        : this.controller.signal,
    )
  }
  private async rpc(
    scope: Scope,
    method: string,
    params: unknown,
    ui: boolean,
    signal = this.controller.signal,
    authorize: () => void = () => {},
  ) {
    const session = await this.connect(scope)
    session.busy++
    try {
      return await this.performRpc(session, scope, method, params, ui, signal, authorize)
    } finally {
      session.busy--
      session.lastUsed = Date.now()
    }
  }
  private async performRpc(
    session: Session,
    scope: Scope,
    method: string,
    params: unknown,
    ui: boolean,
    signal: AbortSignal,
    authorize: () => void,
  ) {
    authorize()
    signal.throwIfAborted()
    if (session.toolsDirty) {
      const tools: Tool[] = [],
        seen = new Set<string>()
      let cursor: string | undefined
      do {
        const page = await session.client.listTools({ cursor }, { signal, timeout: 30_000 })
        tools.push(...page.tools)
        cursor = page.nextCursor
        if (tools.length > 2000 || (cursor && seen.has(cursor)))
          throw new HttpError(502, 'Invalid MCP tool list')
        if (cursor) seen.add(cursor)
      } while (cursor)
      session.tools = tools
      session.toolsDirty = false
    }
    const value = object(params)
    const options = { signal, timeout: 60_000 }
    if (method === 'tools/list')
      return {
        tools: [
          ...session.tools.filter((tool) => visibleTo(tool, ui ? 'app' : 'model')),
          ...(ui ? [] : [...appViewTools, ...this.views.list(scope)]),
        ],
      }
    if (method === 'tools/call') {
      const request = CallToolRequestSchema.safeParse({ method, params })
      if (!request.success) throw new HttpError(400, 'Invalid MCP tools/call parameters')
      const input = request.data.params
      if (input.task)
        throw new HttpError(400, 'Task-augmented MCP calls are not supported by this bridge')
      if (!ui && input.name === 'dovo_app_list_tools')
        return { content: [{ type: 'text', text: JSON.stringify(this.views.list(scope)) }] }
      if (!ui && input.name === 'dovo_app_call_tool') {
        const args = input.arguments ?? {}
        if (
          typeof args.name !== 'string' ||
          (args.arguments !== undefined &&
            (!args.arguments ||
              typeof args.arguments !== 'object' ||
              Array.isArray(args.arguments)))
        )
          throw new HttpError(400, 'Invalid MCP App tool arguments')
        return this.views.call(scope, args.name, args.arguments ?? {}, signal)
      }
      if (!ui && input.name.startsWith('dovo_app_'))
        return this.views.call(scope, input.name, input.arguments ?? {}, signal)
      const tool = session.tools.find(
        (tool) => tool.name === input.name && visibleTo(tool, ui ? 'app' : 'model'),
      )
      if (!tool) throw new HttpError(403, 'Tool is not available in this MCP scope')
      if (ui) {
        const task = this.store.task(scope.taskId)
        if (task.status === 'done' || task.archivedAt)
          throw new HttpError(409, 'Reopen this thread before using its MCP Apps')
        if (scope.permission === 'read-only')
          throw new HttpError(403, 'Interactive tool calls are disabled for read-only threads')
        const allowed = await this.approvals.request(
          scope.taskId,
          `MCP App · ${tool.name}`,
          JSON.stringify(input.arguments ?? {}),
          signal,
        )
        if (!allowed) throw new HttpError(403, 'MCP App tool call was declined')
        const latest = this.current(scope.taskId, scope.server.name)
        if (
          fingerprint(latest.server) !== fingerprint(scope.server) ||
          latest.permission !== scope.permission
        )
          throw new HttpError(409, 'MCP configuration changed during approval')
      }
      authorize()
      signal.throwIfAborted()
      const result = CallToolResultSchema.parse(
        await session.client.callTool(
          { name: tool.name, arguments: input.arguments ?? {}, _meta: input._meta },
          undefined,
          options,
        ),
      )
      if (!ui) await this.capture(scope, session, tool, input.arguments ?? {}, result)
      // UI content is out-of-band, not model tokens or repeated sync payloads.
      const embeddedApps = new Set(legacyResources(result))
      const content = result.content.filter(
        (item) => item.type !== 'resource' || !embeddedApps.has(item.resource),
      )
      return ui
        ? result
        : {
            ...result,
            content: content.length
              ? content
              : [{ type: 'text', text: 'Interactive result is available in Dovo.' }],
          }
    }
    const pagination = typeof value.cursor === 'string' ? { cursor: value.cursor } : undefined
    if (method === 'resources/list') return session.client.listResources(pagination, options)
    if (method === 'resources/templates/list')
      return session.client.listResourceTemplates(pagination, options)
    if (method === 'resources/read' && typeof value.uri === 'string')
      return session.client.readResource({ uri: value.uri }, options)
    if (method === 'prompts/list') return session.client.listPrompts(pagination, options)
    if (method === 'prompts/get') {
      const request = GetPromptRequestSchema.safeParse({ method, params })
      if (!request.success) throw new HttpError(400, 'Invalid MCP prompts/get parameters')
      return session.client.getPrompt(
        { ...request.data.params, arguments: request.data.params.arguments ?? {} },
        options,
      )
    }
    throw new HttpError(400, 'Unsupported MCP bridge method')
  }
  private async resource(session: Session, uri: string) {
    const resource = htmlResource(
      await session.client.readResource(
        { uri },
        { signal: this.controller.signal, timeout: 30_000 },
      ),
      uri,
    )
    if (object(resource._meta?.ui).csp || !session.client.getServerCapabilities()?.resources)
      return resource
    const seen = new Set<string>()
    let cursor: string | undefined,
      count = 0
    do {
      const page = await session.client
        .listResources({ cursor }, { signal: this.controller.signal, timeout: 30_000 })
        .catch((error: unknown) => {
          if (error instanceof McpError && error.code === ErrorCode.MethodNotFound) return undefined
          throw error
        })
      if (!page) return resource
      const listed = page.resources.find((entry) => entry.uri === uri)
      if (listed)
        return {
          ...resource,
          _meta: {
            ...listed._meta,
            ...resource._meta,
            ui: { ...object(listed._meta?.ui), ...object(resource._meta?.ui) },
          },
        }
      count += page.resources.length
      cursor = page.nextCursor
      if (count > 2000 || (cursor && seen.has(cursor)))
        throw new HttpError(502, 'Invalid MCP resource list')
      if (cursor) seen.add(cursor)
    } while (cursor)
    return resource
  }
  private async capture(
    scope: Scope,
    session: Session,
    tool: Tool,
    input: Record<string, unknown>,
    result: CallToolResult,
  ) {
    const resources: Array<{ resource: unknown; format: 'apps' | 'legacy' }> = legacyResources(
      result,
    ).map((resource) => ({ resource, format: isAppMime(resource.mimeType) ? 'apps' : 'legacy' }))
    const uri = appUri(tool)
    if (uri) {
      try {
        resources.unshift({
          resource: await this.resource(session, uri),
          format: 'apps',
        })
      } catch (error) {
        this.activity.add('error', scope.taskId, `MCP App unavailable · ${tool.name}`, {
          error: String(error),
        })
      }
    }
    const refs = []
    for (const { resource, format } of resources.slice(0, 8)) {
      const id = randomUUID()
      const app: StoredApp = {
        id,
        taskId: scope.taskId,
        title: tool.title ?? tool.name,
        server: scope.server.name,
        tool: tool.name,
        input,
        result,
        resource,
        format,
        connected: true,
        fingerprint: fingerprint(scope.server),
        cwd: scope.cwd,
      }
      const serialized = JSON.stringify(app)
      if (Buffer.byteLength(serialized) > MAX_APP_BYTES) continue
      this.db.prepare('INSERT INTO mcp_apps VALUES (?,?,?)').run(id, scope.taskId, serialized)
      refs.push({ id, taskId: scope.taskId, title: app.title })
    }
    for (const ref of refs) {
      const task = this.store.task(scope.taskId)
      const turn = task.turns?.at(-1)
      const envelope = {
        turnId: turn?.id,
        toolId: `mcp-app:${ref.id}`,
        status: result.isError ? 'failed' : 'completed',
        textOffset:
          task.messages.at(-1)?.role === 'assistant' ? task.messages.at(-1)?.text.length : 0,
        mcpApps: [ref],
      }
      const saved = this.saved(scope.taskId, ref.id)
      this.db
        .prepare('UPDATE mcp_apps SET value=? WHERE id=?')
        .run(JSON.stringify({ ...saved, envelope }), ref.id)
      this.activity.add(
        'tool',
        scope.taskId,
        `MCP App · ${tool.title ?? tool.name}`,
        envelope,
        `mcp-app:${ref.id}`,
      )
    }
  }
  private changed(scope: Scope) {
    if (!this.store.get().tasks.some((task) => task.id === scope.taskId)) return
    const rows = this.db.prepare('SELECT value FROM mcp_apps WHERE task_id=?').all(scope.taskId)
    for (const row of rows) {
      const value = object(row).value
      if (typeof value !== 'string') continue
      const app = object(JSON.parse(value))
      if (app.server !== scope.server.name || app.fingerprint !== fingerprint(scope.server))
        continue
      const envelope = object(app.envelope),
        ref = {
          id: app.id,
          taskId: scope.taskId,
          title: app.title,
          revision: typeof app.revision === 'number' ? app.revision + 1 : 1,
        }
      this.db.prepare('UPDATE mcp_apps SET value=? WHERE id=?').run(
        JSON.stringify({
          ...app,
          revision: ref.revision,
          envelope: { ...envelope, mcpApps: [ref] },
        }),
        app.id,
      )
      this.activity.add(
        'tool',
        scope.taskId,
        `MCP App · ${String(app.title)}`,
        { ...envelope, mcpApps: [ref] },
        `mcp-app:${String(app.id)}`,
      )
    }
  }

  private saved(taskId: string, id: string): StoredApp {
    this.store.task(taskId)
    const row = object(
      this.db.prepare('SELECT value FROM mcp_apps WHERE id=? AND task_id=?').get(id, taskId),
    )
    if (typeof row.value !== 'string') throw new HttpError(404, 'MCP App not found in this thread')
    const raw: unknown = JSON.parse(row.value)
    const app = decode(mcpAppSchema, raw)
    const hash = object(raw).fingerprint
    if (typeof hash !== 'string') throw new HttpError(409, 'MCP App configuration is unavailable')
    const cwd = object(raw).cwd
    if (typeof cwd !== 'string') throw new HttpError(409, 'MCP App checkout is unavailable')
    return { ...app, fingerprint: hash, cwd }
  }
  read(taskId: string, id: string): McpApp {
    const { fingerprint: hash, cwd: _cwd, ...app } = this.saved(taskId, id)
    try {
      app.connected = fingerprint(this.current(taskId, app.server).server) === hash
    } catch {
      app.connected = false
    }
    return app
  }
  attachView(
    taskId: string,
    id: string,
    send: (value: unknown) => void,
    authorize: () => void,
    disconnected: () => void,
  ) {
    const app = this.saved(taskId, id)
    if (app.format !== 'apps') throw new HttpError(400, 'Legacy apps do not expose tools')
    return this.views.attach(
      { taskId, appId: id, server: app.server, title: app.title },
      send,
      () => {
        authorize()
        if (fingerprint(this.current(taskId, app.server).server) !== app.fingerprint)
          throw new HttpError(403, 'MCP configuration changed')
      },
      disconnected,
    )
  }
  async action(
    taskId: string,
    id: string,
    requestId: string,
    method: string,
    params: unknown,
    authorize: () => void = () => {},
  ) {
    const app = this.saved(taskId, id)
    if (method === 'ui/cancel') {
      const target = object(params).requestId
      if (typeof target === 'string')
        this.actions.get(`${taskId}:${id}:${target}`)?.controller.abort()
      return {}
    }
    const scope = this.current(taskId, app.server)
    if (fingerprint(scope.server) !== app.fingerprint)
      throw new HttpError(409, 'This saved app uses an older MCP configuration')
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(requestId))
      throw new HttpError(400, 'Invalid MCP App request identity')
    const key = `${taskId}:${id}:${requestId}`,
      input = JSON.stringify({ method, params })
    const previous = this.actions.get(key)
    if (previous) {
      if (previous.input !== input) throw new HttpError(409, 'MCP App request identity was reused')
      return previous.promise
    }
    if (this.actions.size >= 1000)
      throw new HttpError(429, 'MCP App action capacity reached; reopen the thread later')
    const mutation = ['tools/call', 'ui/message', 'ui/intent'].includes(method)
    const persisted = mutation
      ? object(this.db.prepare('SELECT * FROM mcp_app_actions WHERE id=?').get(key))
      : {}
    if (persisted.input !== undefined) {
      if (persisted.input !== input) throw new HttpError(409, 'MCP App request identity was reused')
      if (persisted.state === 'failed' && typeof persisted.result === 'string') {
        const failure = object(JSON.parse(persisted.result))
        throw new HttpError(
          typeof failure.status === 'number' ? failure.status : 409,
          typeof failure.error === 'string' ? failure.error : 'App action failed',
        )
      }
      if (persisted.state !== 'completed' || typeof persisted.result !== 'string')
        throw new HttpError(
          409,
          'This app action was interrupted. Check its outcome before starting another action.',
        )
      return JSON.parse(persisted.result)
    }
    if (mutation)
      this.db.prepare('INSERT INTO mcp_app_actions VALUES (?,?,?,NULL)').run(key, input, 'pending')
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, this.controller.signal])
    const perform = async () => {
      authorize()
      signal.throwIfAborted()
      if (method === 'ui/update-model-context') {
        if (input.length > 32000) throw new HttpError(413, 'MCP App context is too large')
        this.db
          .prepare('INSERT OR REPLACE INTO documents VALUES (?,?)')
          .run(
            `mcp-app-context:${taskId}:${id}`,
            JSON.stringify({ source: app.title, context: params }),
          )
        return {}
      }
      if (method === 'ui/message' || method === 'ui/intent') {
        if (scope.permission === 'read-only')
          throw new HttpError(403, 'Messages from MCP Apps are disabled in read-only threads')
        const value = object(params)
        const content = Array.isArray(value.content) ? value.content : []
        const text =
          method === 'ui/intent'
            ? JSON.stringify({ intent: value.intent, params: value.params })
            : content
                .map((part) => {
                  const item = object(part)
                  if (item.type !== 'text' || typeof item.text !== 'string')
                    throw new HttpError(400, 'This host accepts text app messages')
                  return item.text
                })
                .join('\n')
        if (
          !text.trim() ||
          text.length > 32000 ||
          (method === 'ui/message' && value.role !== 'user')
        )
          throw new HttpError(400, 'Invalid app message')
        if (!this.sendMessage) throw new HttpError(503, 'Thread messaging is unavailable')
        await this.sendMessage(taskId, randomUUID(), `[MCP App: ${app.title}]\n${text}`)
        return {}
      }
      return this.rpc(scope, method, params, true, signal, authorize)
    }
    const promise = perform()
      .then((result) => {
        if (mutation) {
          const encoded = JSON.stringify(result)
          if (encoded.length > MAX_APP_BYTES)
            throw new HttpError(413, 'MCP App result is too large')
          this.db
            .prepare('UPDATE mcp_app_actions SET state=?,result=? WHERE id=?')
            .run('completed', encoded, key)
        }
        return result
      })
      .catch((error: unknown) => {
        if (mutation && error instanceof HttpError && error.status < 500 && error.status !== 413)
          this.db
            .prepare('UPDATE mcp_app_actions SET state=?,result=? WHERE id=?')
            .run('failed', JSON.stringify({ error: error.message, status: error.status }), key)
        throw error
      })
    this.actions.set(key, { taskId, input, promise, controller })
    // Keep settled requests briefly for network retries, without retaining an unbounded heap.
    void promise
      .finally(() => {
        const timer = setTimeout(() => this.actions.delete(key), 5 * 60 * 1000)
        timer.unref()
      })
      .catch(() => {})
    return promise
  }
  async reconcile() {
    const tasks = new Map(this.store.get().tasks.map((task) => [task.id, task]))
    const invalid = new Set<string>()
    for (const [token, scope] of this.scopes) {
      const task = tasks.get(scope.taskId)
      if (task && !task.archivedAt && task.status !== 'done') continue
      this.scopes.delete(token)
      this.cancelTask(scope.taskId)
      invalid.add(`${scope.taskId}:${fingerprint(scope.server)}:${scope.cwd}`)
    }
    for (const key of this.resolved.keys()) {
      const task = tasks.get(key.slice(0, key.indexOf(':')))
      if (!task || task.archivedAt || task.status === 'done') invalid.add(key)
    }
    for (const key of invalid) {
      const session = this.resolved.get(key)
      if (!session || session.busy) continue
      this.sessions.delete(key)
      this.resolved.delete(key)
      await session.client.close()
      await session.transport.close()
    }
    for (const row of this.db.prepare('SELECT DISTINCT task_id FROM mcp_apps').all()) {
      const id = object(row).task_id
      if (typeof id !== 'string' || tasks.has(id)) continue
      this.db.prepare('DELETE FROM mcp_apps WHERE task_id=?').run(id)
      this.db.prepare('DELETE FROM documents WHERE id LIKE ?').run(`mcp-app-context:${id}:%`)
      this.db.prepare('DELETE FROM mcp_app_actions WHERE id LIKE ?').run(`${id}:%`)
    }
  }
  cancelTask(taskId: string) {
    this.views.cancelTask(taskId)
    for (const action of this.actions.values())
      if (action.taskId === taskId) action.controller.abort()
  }
  async dispose() {
    this.views.dispose()
    this.stopped = true
    this.controller.abort()
    await this.polling?.stop()
    await Promise.allSettled(
      [...this.sessions.values()].map(async (opening) => {
        const session = await opening
        await session.client.close()
        await session.transport.close()
      }),
    )
    this.resolved.clear()
    this.sessions.clear()
    this.scopes.clear()
    this.actions.clear()
  }
}
