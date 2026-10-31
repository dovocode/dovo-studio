import { AppToolViews, appViewTools } from './views.js'
import { startPolling } from '@dovo/client-runtime'
import { runtimeOperation } from '../errors.js'
import { processEnvironment } from '../process.js'
import { randomBytes, randomUUID, createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import type Database from 'better-sqlite3'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv'
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
  permissionPolicyReadOnly,
  mergeResources,
  type McpServer,
  type Agent,
  type McpApp,
  type ArtifactFeedQuery,
  artifactFeedSelect,
  ARTIFACT_FEED_MAX_BYTES,
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
  taskId: string
  server: string
  toolsDirty: boolean
  /** Outstanding leases; only unleased sessions may be retired. */
  busy: number
  lastUsed: number
  closed: boolean
}
type Reservation = { opening: Promise<Session>; waiters: number }
const MAX_SESSIONS = 64
/** Idle upstream sessions close on the next reconcile and reconnect lazily on demand. */
export const MCP_SESSION_IDLE_MS = 10 * 60_000
type Scope = {
  taskId: string
  server: McpServer
  cwd: string
  permission: Agent['permission']
  approvalPolicy?: Agent['approvalPolicy']
  sandboxMode?: Agent['sandboxMode']
  signal?: AbortSignal
}
type StoredApp = McpApp & { fingerprint: string; cwd: string }
const fingerprint = (server: McpServer) =>
  createHash('sha256').update(JSON.stringify(server)).digest('hex')
/** Owns upstream MCP connections; provider proxies never receive their credentials. */
export class McpApps {
  private views = new AppToolViews()
  private sessions = new Map<string, Reservation>()
  private resolved = new Map<string, Session>()
  private closing = new Map<string, Promise<void>>()
  private capacity = MAX_SESSIONS
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
    policy?: Pick<Agent, 'approvalPolicy' | 'sandboxMode'>,
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
          scope.permission === permission &&
          scope.approvalPolicy === policy?.approvalPolicy &&
          scope.sandboxMode === policy?.sandboxMode,
      )
      const token = previous?.[0] ?? randomBytes(32).toString('base64url')
      this.scopes.set(token, {
        taskId,
        server,
        cwd,
        permission,
        signal,
        approvalPolicy: policy?.approvalPolicy,
        sandboxMode: policy?.sandboxMode,
      })
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
    const task = this.store.taskSummary(taskId)
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
    return {
      taskId,
      server,
      cwd,
      permission: permissionPolicyReadOnly(agent) ? 'read-only' : agent.permission,
      approvalPolicy: agent.approvalPolicy,
      sandboxMode: agent.sandboxMode,
    }
  }
  /** Synchronously returns the key's reservation, evicting an unprotected idle session at capacity. */
  private reserve(scope: Scope): Reservation {
    if (this.stopped) throw new HttpError(503, 'MCP bridge is stopping')
    const key = `${scope.taskId}:${fingerprint(scope.server)}:${scope.cwd}`
    const cached = this.sessions.get(key)
    if (cached) return cached
    const prerequisites: Promise<void>[] = []
    const closing = this.closing.get(key)
    if (closing) prerequisites.push(closing)
    if (this.sessions.size >= this.capacity) {
      const tasks = new Map(this.store.get().tasks.map((task) => [task.id, task]))
      const idle = [...this.resolved.values()]
        .filter(
          (session) => this.idle(session) && !this.protects(session, tasks.get(session.taskId)),
        )
        .sort((a, b) => a.lastUsed - b.lastUsed)[0]
      if (!idle)
        throw new HttpError(429, 'All MCP connections are busy; try again when a tool finishes')
      prerequisites.push(this.retire(idle))
    }
    const reservation: Reservation = {
      opening: this.open(scope, key, prerequisites),
      waiters: 0,
    }
    this.sessions.set(key, reservation)
    reservation.opening.catch(() => {
      // Callers own the connection error; only the failed reservation is released here.
      if (this.sessions.get(key) === reservation) this.sessions.delete(key)
    })
    return reservation
  }
  private async open(scope: Scope, key: string, prerequisites: Promise<void>[]) {
    // Never run two upstream processes for one key, or exceed capacity while an eviction closes.
    await Promise.all(prerequisites)
    if (this.stopped) throw new HttpError(503, 'MCP bridge is stopping')
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
                Object.entries(processEnvironment()).filter(
                  (entry): entry is [string, string] => typeof entry[1] === 'string',
                ),
              ),
              ...mcpServerEnvironment(config),
            },
            cwd: scope.cwd,
            stderr: 'pipe',
          })
        : new StreamableHTTPClientTransport(new URL(config.url), mcpHttpOptions(mcpHeaders(config)))
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
        transport = new SSEClientTransport(new URL(config.url), mcpHttpOptions(mcpHeaders(config)))
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
      const session: Session = {
        client,
        transport,
        tools,
        key,
        taskId: scope.taskId,
        server: config.name,
        toolsDirty: false,
        busy: 0,
        lastUsed: Date.now(),
        closed: false,
      }
      if (this.stopped) throw new HttpError(503, 'MCP bridge is stopping')
      // Synchronous through registration: the transport cannot close before the hook exists.
      client.onclose = () => void this.retire(session)
      if (!client.transport) throw new HttpError(502, 'MCP server disconnected')
      client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
        session.toolsDirty = true
        this.changed(scope)
      })
      client.setNotificationHandler(ResourceListChangedNotificationSchema, () =>
        this.changed(scope),
      )
      client.setNotificationHandler(PromptListChangedNotificationSchema, () => this.changed(scope))
      this.resolved.set(key, session)
      return session
    } catch (error) {
      await this.close(client, transport)
      throw error
    }
  }
  /** Leases count from reservation, so retirement cannot slip between connect and use. */
  private async lease(scope: Scope): Promise<Session> {
    const reservation = this.reserve(scope)
    reservation.waiters++
    let session: Session
    try {
      session = await reservation.opening
    } finally {
      reservation.waiters--
    }
    // Only a dead connection or disposal retires a reserved session.
    if (session.closed) throw new HttpError(503, 'MCP server disconnected; try again')
    session.busy++
    return session
  }
  private release(session: Session) {
    session.busy--
    session.lastUsed = Date.now()
  }
  private idle(session: Session) {
    return !session.busy && !this.sessions.get(session.key)?.waiters
  }
  private protects(session: Session, task: { status: string } | undefined) {
    return task?.status === 'running' || this.views.attached(session.taskId, session.server)
  }
  /** Synchronously forgets a session and tracks its close; a replacement is never removed. */
  private retire(session: Session) {
    if (session.closed) return this.closing.get(session.key) ?? Promise.resolve()
    session.closed = true
    if (this.resolved.get(session.key) === session) {
      this.resolved.delete(session.key)
      this.sessions.delete(session.key)
    }
    const previous = this.closing.get(session.key)
    const closed = this.close(session.client, session.transport)
    const tracked = previous ? Promise.all([previous, closed]).then(() => {}) : closed
    this.closing.set(session.key, tracked)
    void tracked.then(() => {
      if (this.closing.get(session.key) === tracked) this.closing.delete(session.key)
    })
    return tracked
  }
  /** Closes both ends and reports failures here, so waiters can rely on settlement. */
  private async close(client: Client, transport: Transport) {
    for (const step of [() => client.close(), () => transport.close()])
      try {
        await step()
      } catch (error) {
        console.error(
          'MCP session close failed',
          error instanceof Error ? error.message : String(error),
        )
      }
  }
  authenticateProxy(token: string) {
    const scope = this.scopes.get(token)
    if (!scope) throw new HttpError(401, 'Invalid MCP bridge credential')
    const current = this.current(scope.taskId, scope.server.name)
    if (
      fingerprint(current.server) !== fingerprint(scope.server) ||
      current.permission !== scope.permission ||
      current.approvalPolicy !== scope.approvalPolicy ||
      current.sandboxMode !== scope.sandboxMode
    )
      throw new HttpError(403, 'MCP configuration changed; start a new turn')
    return scope
  }
  async proxy(token: string, method: string, params: unknown) {
    const scope = this.authenticateProxy(token)
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
    const session = await this.lease(scope)
    try {
      return await this.performRpc(session, scope, method, params, ui, signal, authorize)
    } finally {
      this.release(session)
    }
  }
  /** The returned session stays leased; callers must release it. */
  private async feedTool(
    taskId: string,
    server: string,
    name: string,
    signal: AbortSignal,
    authorize: () => void,
    expected?: string,
  ) {
    const scope = this.current(taskId, server)
    if (scope.permission === 'read-only')
      throw new HttpError(403, 'Live feeds are disabled for read-only threads')
    const scopeKey = createHash('sha256')
      .update(
        JSON.stringify({
          server: fingerprint(scope.server),
          cwd: scope.cwd,
          permission: scope.permission,
          approvalPolicy: scope.approvalPolicy,
          sandboxMode: scope.sandboxMode,
        }),
      )
      .digest('hex')
    if (expected && !expected.startsWith(scopeKey + ':'))
      throw new HttpError(409, 'MCP configuration changed; preview and approve again')
    authorize()
    signal.throwIfAborted()
    const session = await this.lease(scope)
    try {
      // Recheck the upstream declaration before every background read, even without notifications.
      session.toolsDirty = true
      await this.performRpc(session, scope, 'tools/list', {}, true, signal, authorize)
      const tool = session.tools.find((tool) => tool.name === name)
      if (
        !tool ||
        tool.annotations?.readOnlyHint !== true ||
        tool.annotations.destructiveHint === true
      )
        throw new HttpError(
          403,
          'Data feeds require a tool explicitly declared read-only and non-destructive',
        )
      const key = scopeKey + ':' + createHash('sha256').update(JSON.stringify(tool)).digest('hex')
      if (expected && expected !== key)
        throw new HttpError(409, 'MCP tool changed; preview and approve again')
      return { scope, session, tool, key }
    } catch (error) {
      this.release(session)
      throw error
    }
  }
  async feedCatalog(taskId: string, signal: AbortSignal, authorize: () => void) {
    const task = this.store.taskSummary(taskId),
      agent = resolveTaskAgent(task, this.store.get().agents)
    if (!agent || permissionPolicyReadOnly(agent))
      throw new HttpError(403, 'Live feeds require an editable thread')
    const servers = mergeResources(
      this.store.projectSettings(task.repositoryId).resources,
      agent.resources,
    ).mcpServers.filter((server) => server.enabled && server.name !== 'dovo_task')
    if (servers.length > 32) throw new HttpError(413, 'Too many configured MCP servers')
    const tools: Array<{
      server: string
      tool: string
      description: string
      inputSchema: unknown
    }> = []
    for (const server of servers) {
      authorize()
      signal.throwIfAborted()
      const scope = this.current(taskId, server.name),
        session = await this.lease(scope)
      try {
        session.toolsDirty = true
        await this.performRpc(session, scope, 'tools/list', {}, true, signal, authorize)
        for (const tool of session.tools)
          if (tool.annotations?.readOnlyHint === true && tool.annotations.destructiveHint !== true)
            tools.push({
              server: server.name,
              tool: tool.name,
              description: tool.description ?? '',
              inputSchema: tool.inputSchema,
            })
      } finally {
        this.release(session)
      }
      if (tools.length > 500) throw new HttpError(413, 'Too many read-only tools')
    }
    return { tools }
  }
  async feedRead(
    taskId: string,
    query: ArtifactFeedQuery,
    expected: string | undefined,
    signal: AbortSignal,
    authorize: () => void,
  ) {
    const { scope, session, tool, key } = await this.feedTool(
      taskId,
      query.server,
      query.tool,
      signal,
      authorize,
      expected,
    )
    try {
      if (expected && expected !== key)
        throw new HttpError(409, 'MCP tool or configuration changed; preview and approve again')
      const validation = new AjvJsonSchemaValidator().getValidator(tool.inputSchema)(
        query.arguments,
      )
      if (!validation.valid)
        throw new HttpError(400, 'Arguments do not match the MCP tool input schema')
      authorize()
      signal.throwIfAborted()
      const result = CallToolResultSchema.parse(
        await session.client.callTool({ name: tool.name, arguments: query.arguments }, undefined, {
          signal,
          timeout: 30_000,
        }),
      )
      authorize()
      signal.throwIfAborted()
      const current = this.current(taskId, query.server)
      if (
        fingerprint(current.server) !== fingerprint(scope.server) ||
        current.permission !== scope.permission ||
        current.approvalPolicy !== scope.approvalPolicy ||
        current.sandboxMode !== scope.sandboxMode
      )
        throw new HttpError(409, 'MCP configuration changed during the read')
      if (result.isError) throw new HttpError(502, 'MCP data read failed')
      let value: unknown = result.structuredContent
      if (value === undefined) {
        const text = result.content
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('\n')
        try {
          value = JSON.parse(text) as unknown
        } catch {
          value = text
        }
      }
      const data = artifactFeedSelect(value, query.pointer),
        encoded = JSON.stringify(data)
      if (encoded === undefined || Buffer.byteLength(encoded) > ARTIFACT_FEED_MAX_BYTES)
        throw new HttpError(413, 'Select a JSON field smaller than 256 KB')
      return { fingerprint: key, data: JSON.parse(encoded) as unknown }
    } finally {
      this.release(session)
    }
  }
  async feedCheck(
    taskId: string,
    query: ArtifactFeedQuery,
    expected: string,
    signal: AbortSignal,
    authorize: () => void,
  ) {
    const { session, key } = await this.feedTool(
      taskId,
      query.server,
      query.tool,
      signal,
      authorize,
      expected,
    )
    this.release(session)
    if (key !== expected)
      throw new HttpError(409, 'MCP tool or configuration changed; preview and approve again')
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
    if (session.toolsDirty && (method === 'tools/list' || method === 'tools/call')) {
      const tools: Tool[] = [],
        seen = new Set<string>()
      const toolListSignal = AbortSignal.any([signal, AbortSignal.timeout(30_000)])
      let cursor: string | undefined
      do {
        const page = await session.client.listTools(
          { cursor },
          { signal: toolListSignal, timeout: 30_000 },
        )
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
        const task = this.store.taskSummary(scope.taskId)
        if (task.status === 'done' || task.archivedAt)
          throw new HttpError(409, 'Reopen this thread before using its MCP Apps')
        if (scope.permission === 'read-only')
          throw new HttpError(403, 'Interactive tool calls are disabled for read-only threads')
        const decision = await this.approvals.request(
          scope.taskId,
          `MCP App · ${tool.name}`,
          JSON.stringify(input.arguments ?? {}),
          signal,
        )
        if (decision === 'deny') throw new HttpError(403, 'MCP App tool call was declined')
        const latest = this.current(scope.taskId, scope.server.name)
        if (
          fingerprint(latest.server) !== fingerprint(scope.server) ||
          latest.permission !== scope.permission ||
          latest.approvalPolicy !== scope.approvalPolicy ||
          latest.sandboxMode !== scope.sandboxMode
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
    const capabilities = session.client.getServerCapabilities()
    if (method === 'resources/list')
      return capabilities?.resources
        ? session.client.listResources(pagination, options)
        : { resources: [] }
    if (method === 'resources/templates/list')
      return capabilities?.resources
        ? session.client.listResourceTemplates(pagination, options)
        : { resourceTemplates: [] }
    if (method === 'resources/read' && typeof value.uri === 'string')
      return session.client.readResource({ uri: value.uri }, options)
    if (method === 'prompts/list')
      return capabilities?.prompts
        ? session.client.listPrompts(pagination, options)
        : { prompts: [] }
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
    this.store.taskSummary(taskId)
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
    for (const [token, scope] of this.scopes) {
      const task = tasks.get(scope.taskId)
      if (task && !task.archived && !task.archivedAt && task.status !== 'done') continue
      this.scopes.delete(token)
      this.cancelTask(scope.taskId)
    }
    // Retire synchronously, then await closes, so no lease can interleave with the selection.
    const now = Date.now(),
      closing: Promise<void>[] = []
    for (const session of [...this.resolved.values()]) {
      if (!this.idle(session)) continue
      const task = tasks.get(session.taskId)
      if (!task || task.archived || task.archivedAt || task.status === 'done') {
        closing.push(this.retire(session))
        continue
      }
      // Running turns and open views keep their session; idle time starts once they end.
      if (this.protects(session, task)) session.lastUsed = now
      else if (now - session.lastUsed >= MCP_SESSION_IDLE_MS) closing.push(this.retire(session))
    }
    await Promise.all(closing)
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
    // Opening errors belong to their callers; disposal only needs them settled.
    await Promise.allSettled([...this.sessions.values()].map(({ opening }) => opening))
    for (const session of [...this.resolved.values()]) void this.retire(session)
    while (this.closing.size) await Promise.all(this.closing.values())
    this.scopes.clear()
    this.actions.clear()
  }
}
