import { randomUUID, createHash } from 'node:crypto'
import type Database from 'better-sqlite3'
import { Schema } from 'effect'
import {
  decode,
  mutableArray,
  mutableStruct,
  reportedPlanLimits,
  usageHubInputSchema,
  usageHubSchema,
  type UsageHub,
  type UsageHubInput,
  type PlanLimit,
} from '@dovo/protocol'
import { reportedUsageAccount } from '../agents/tasks/usage-account.js'
import { HttpError } from '../errors.js'
const storedSchema = mutableStruct({
  ...usageHubInputSchema.fields,
  id: Schema.String,
  revision: Schema.String,
  managementKey: Schema.String,
})
type Stored = Schema.Schema.Type<typeof storedSchema>
const rowSchema = mutableStruct({ value: Schema.String })
const authSchema = mutableStruct({
  files: mutableArray(
    mutableStruct({
      id: Schema.String,
      auth_index: Schema.String,
      provider: Schema.String,
      email: Schema.optional(Schema.String),
      disabled: Schema.optional(Schema.Boolean),
      id_token: Schema.optional(
        mutableStruct({
          chatgpt_account_id: Schema.optional(Schema.String),
          chatgpt_plan_type: Schema.optional(Schema.String),
          plan_type: Schema.optional(Schema.String),
        }),
      ),
    }),
  ),
})
const responseSchema = mutableStruct({ status_code: Schema.Number, body: Schema.String })
const codexWindow = Schema.NullOr(
  mutableStruct({
    used_percent: Schema.Number.pipe(Schema.check(Schema.isFinite())),
    reset_at: Schema.optional(Schema.NullOr(Schema.Number)),
    limit_window_seconds: Schema.optional(Schema.Number),
  }),
)
const codexSchema = mutableStruct({
  plan_type: Schema.optional(Schema.String),
  rate_limit: Schema.NullOr(
    mutableStruct({
      primary_window: Schema.optional(codexWindow),
      secondary_window: Schema.optional(codexWindow),
    }),
  ),
})
const claudeWindow = Schema.NullOr(
  mutableStruct({
    utilization: Schema.Number.pipe(Schema.check(Schema.isFinite())),
    resets_at: Schema.optional(Schema.NullOr(Schema.String)),
  }),
)
const claudeSchema = mutableStruct({
  five_hour: Schema.optional(claudeWindow),
  seven_day: Schema.optional(claudeWindow),
  seven_day_sonnet: Schema.optional(claudeWindow),
  seven_day_opus: Schema.optional(claudeWindow),
  limits: Schema.optional(
    mutableArray(
      mutableStruct({
        kind: Schema.String,
        percent: Schema.optional(Schema.NullOr(Schema.Number)),
        resets_at: Schema.optional(Schema.NullOr(Schema.String)),
        scope: Schema.optional(
          Schema.NullOr(
            mutableStruct({
              model: Schema.optional(Schema.NullOr(mutableStruct({ display_name: Schema.String }))),
            }),
          ),
        ),
      }),
    ),
  ),
})
function hubUrl(value: string) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new HttpError(400, 'Enter a valid hub URL.')
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new HttpError(400, 'Use an HTTP or HTTPS hub URL without credentials, query or fragment.')
  url.pathname = url.pathname.replace(/\/v0\/management\/?$/, '').replace(/\/$/, '') + '/'
  return url.toString()
}
/** Host-private configuration; no management keys are projected into workspace/client caches. */
export class UsageHubs {
  private shutdown = new AbortController()
  private cache = new Map<
    string,
    { revision: string; at: number; value: UsageHub; pending?: Promise<UsageHub> }
  >()
  constructor(private db: Database.Database) {
    db.exec(
      'CREATE TABLE IF NOT EXISTS usage_hubs (id TEXT PRIMARY KEY, value TEXT NOT NULL, reading TEXT)',
    )
  }
  private entries() {
    return this.db
      .prepare('SELECT value FROM usage_hubs ORDER BY id')
      .all()
      .map((row) => decode(storedSchema, JSON.parse(decode(rowSchema, row).value)))
  }
  private public(entry: Stored): UsageHub {
    return { id: entry.id, label: entry.label, url: entry.url, enabled: entry.enabled, limits: [] }
  }
  list(): UsageHub[] {
    return this.entries().map((entry) => {
      const cached = this.cache.get(entry.id)
      if (entry.enabled && cached?.revision === entry.revision) return cached.value
      if (entry.enabled) {
        const raw = this.db.prepare('SELECT reading FROM usage_hubs WHERE id=?').get(entry.id)
        const saved = decode(mutableStruct({ reading: Schema.NullOr(Schema.String) }), raw).reading
        if (saved)
          return {
            ...decode(usageHubSchema, JSON.parse(saved)),
            id: entry.id,
            label: entry.label,
            url: entry.url,
            enabled: entry.enabled,
          }
      }
      return this.public(entry)
    })
  }
  save(input: UsageHubInput) {
    const previous = input.id ? this.entries().find((entry) => entry.id === input.id) : undefined
    if (input.id && !previous) throw new HttpError(404, 'This hub no longer exists.')
    if (!previous && this.entries().length >= 16)
      throw new HttpError(400, 'A runtime supports up to 16 usage hubs.')
    if (!input.label.trim()) throw new HttpError(400, 'Enter a hub name.')
    const url = hubUrl(input.url)
    if ((!previous || previous.url !== url) && !input.managementKey)
      throw new HttpError(400, 'Enter the management key for this hub URL.')
    const entry = decode(storedSchema, {
      ...input,
      label: input.label.trim(),
      url,
      id: previous?.id ?? randomUUID(),
      revision: randomUUID(),
      managementKey: input.managementKey ?? previous?.managementKey,
    })
    this.db
      .prepare(
        'INSERT INTO usage_hubs(id,value,reading) VALUES(?,?,NULL) ON CONFLICT(id) DO UPDATE SET value=excluded.value,reading=NULL',
      )
      .run(entry.id, JSON.stringify(entry))
    this.cache.delete(entry.id)
    return this.public(entry)
  }
  remove(id: string) {
    this.db.prepare('DELETE FROM usage_hubs WHERE id=?').run(id)
    this.cache.delete(id)
  }
  private async management(
    entry: Stored,
    path: string,
    body: unknown,
    signal: AbortSignal,
  ): Promise<unknown> {
    // Redirects must never forward a management key to a different destination.
    let response: Response
    try {
      response = await fetch(new URL(`v0/management/${path}`, entry.url), {
        method: body === undefined ? 'GET' : 'POST',
        redirect: 'error',
        headers: {
          Authorization: `Bearer ${entry.managementKey}`,
          'Content-Type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.any([this.shutdown.signal, signal, AbortSignal.timeout(15000)]),
      })
      if (!response.ok) throw new Error(`Hub returned HTTP ${response.status}.`)
      // Auth-file responses may contain secrets. Never include response bodies in errors.
      if (!response.body) throw new Error('Empty response')
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let bytes = 0
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          bytes += value.byteLength
          if (bytes > 4 * 1024 * 1024) throw new Error('Response too large')
          chunks.push(value)
        }
      } finally {
        await reader.cancel()
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'))
    } catch {
      throw new Error('Hub request failed. Check its address, management key and connectivity.')
    }
  }
  private async probe(entry: Stored, signal: AbortSignal): Promise<UsageHub> {
    const accounts = decode(
      authSchema,
      await this.management(entry, 'auth-files', undefined, signal),
    ).files.filter((account) => !account.disabled && ['codex', 'claude'].includes(account.provider))
    const limits: PlanLimit[] = [],
      failures: string[] = []
    const iterator = accounts.values()
    await Promise.all(
      Array.from({ length: Math.min(4, accounts.length) }, async () => {
        for (let next = iterator.next(); !next.done; next = iterator.next()) {
          const account = next.value
          try {
            const codex = account.provider === 'codex'
            const response = decode(
              responseSchema,
              await this.management(
                entry,
                'api-call',
                {
                  auth_index: account.auth_index,
                  method: 'GET',
                  url: codex
                    ? 'https://chatgpt.com/backend-api/wham/usage'
                    : 'https://api.anthropic.com/api/oauth/usage',
                  header: codex
                    ? {
                        Authorization: 'Bearer $TOKEN$',
                        'OpenAI-Beta': 'codex-1',
                        Originator: 'Codex Desktop',
                        ...(account.id_token?.chatgpt_account_id
                          ? { 'Chatgpt-Account-Id': account.id_token.chatgpt_account_id }
                          : {}),
                      }
                    : {
                        Authorization: 'Bearer $TOKEN$',
                        'anthropic-beta': 'oauth-2025-04-20',
                        'User-Agent': 'claude-code/2.1.273',
                      },
                },
                signal,
              ),
            )
            if (response.status_code < 200 || response.status_code >= 300)
              throw new Error('Provider refused hub request')
            let reading: PlanLimit[], identity: PlanLimit['account']
            if (codex) {
              const usage = decode(codexSchema, JSON.parse(response.body))
              const window = (value: Schema.Schema.Type<typeof codexWindow> | undefined) =>
                value
                  ? {
                      usedPercent: value.used_percent,
                      resetsAt: value.reset_at,
                      windowDurationMins: value.limit_window_seconds
                        ? value.limit_window_seconds / 60
                        : undefined,
                    }
                  : undefined
              reading = reportedPlanLimits('codex', 'account/rateLimits/read', {
                rateLimits: {
                  primary: window(usage.rate_limit?.primary_window),
                  secondary: window(usage.rate_limit?.secondary_window),
                },
              })
              identity = reportedUsageAccount('codex', 'account/read', {
                account: {
                  type: 'chatgpt',
                  email: account.email,
                  planType:
                    usage.plan_type ??
                    account.id_token?.chatgpt_plan_type ??
                    account.id_token?.plan_type,
                },
                workspaceRouting: account.id_token?.chatgpt_account_id
                  ? { chatgptAccountId: account.id_token.chatgpt_account_id }
                  : undefined,
              })
            } else {
              const usage = decode(claudeSchema, JSON.parse(response.body))
              reading = reportedPlanLimits('claude', 'account/usage/read', {
                ...usage,
                model_scoped: (usage.limits ?? []).flatMap((limit) =>
                  limit.kind === 'weekly_scoped' &&
                  limit.scope?.model &&
                  typeof limit.percent === 'number'
                    ? [
                        {
                          display_name: limit.scope.model.display_name,
                          utilization: limit.percent,
                          resets_at: limit.resets_at,
                        },
                      ]
                    : [],
                ),
              })
            }
            // Without a verified workspace identity, only deduplicate the same hub/auth file.
            identity ??= {
              id: createHash('sha256')
                .update(JSON.stringify([entry.url, account.provider, account.id]))
                .digest('hex'),
              label: account.email ?? account.id,
            }
            limits.push(...reading.map((limit) => ({ ...limit, account: identity })))
          } catch {
            failures.push('An account could not report limits.')
          }
        }
      }),
    )
    return {
      ...this.public(entry),
      limits,
      checkedAt: new Date().toISOString(),
      ...(failures.length
        ? { error: `${failures.length} of ${accounts.length} accounts could not report limits.` }
        : {}),
    }
  }
  async dispose() {
    this.shutdown.abort()
    const pending = [...this.cache.values()].flatMap((entry) =>
      entry.pending ? [entry.pending] : [],
    )
    this.cache.clear()
    await Promise.allSettled(pending)
  }
  async read(force = false): Promise<UsageHub[]> {
    if (this.shutdown.signal.aborted) return this.db.open ? this.list() : []
    const signal = AbortSignal.timeout(20000)
    const savedById = new Map(this.list().map((hub) => [hub.id, hub]))
    const iterator = this.entries().values()
    await Promise.all(
      Array.from({ length: 2 }, async () => {
        for (let next = iterator.next(); !next.done; next = iterator.next()) {
          const entry = next.value
          if (!entry.enabled || this.shutdown.signal.aborted) continue
          const old = this.cache.get(entry.id)
          if (old?.revision === entry.revision && old.pending) {
            await old.pending
            continue
          }
          if (!force && old?.revision === entry.revision && Date.now() - old.at < 300000) continue
          const saved = savedById.get(entry.id) ?? this.public(entry)
          const current = {
            revision: entry.revision,
            at: Date.now(),
            value: saved,
            pending: undefined as Promise<UsageHub> | undefined,
          }
          const pending = this.probe(entry, signal)
            .catch(() => ({
              ...saved,
              error:
                'The hub could not report usage. Check its address, management key and connectivity.',
            }))
            .then((value) => {
              if (this.db.open && this.cache.get(entry.id) === current) {
                current.value = value
                current.at = Date.now()
                this.db
                  .prepare(
                    "UPDATE usage_hubs SET reading=? WHERE id=? AND json_extract(value,'$.revision')=?",
                  )
                  .run(JSON.stringify(value), entry.id, entry.revision)
              }
              return value
            })
            .finally(() => {
              current.pending = undefined
            })
          current.pending = pending
          this.cache.set(entry.id, current)
          await pending
        }
      }),
    )
    // Re-read current membership so removed/edited hubs cannot be resurrected by old reads.
    return this.db.open ? this.list() : []
  }
}
