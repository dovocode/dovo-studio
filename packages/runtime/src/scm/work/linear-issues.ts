import { Schema } from 'effect'
import {
  decode,
  linearConnectionsSchema,
  linearIssueQuerySchema,
  mutableArray,
  mutableStruct,
  type LinearConnectionCommand,
} from '@dovo/protocol'
import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { linearKeySourceSchema } from '@dovo/protocol'
import { HttpError } from '../../errors.js'

const responseSchema = mutableStruct({
  data: Schema.optional(
    mutableStruct({
      issues: mutableStruct({
        nodes: mutableArray(
          mutableStruct({
            id: Schema.String,
            identifier: Schema.String,
            title: Schema.String,
            description: Schema.NullOr(Schema.String),
            url: Schema.String,
            state: mutableStruct({ name: Schema.String }),
          }),
        ),
        pageInfo: mutableStruct({
          hasNextPage: Schema.Boolean,
          endCursor: Schema.NullOr(Schema.String),
        }),
      }),
    }),
  ),
  errors: Schema.optional(mutableArray(Schema.Unknown)),
})

const query = `query DovoIssues($after: String, $filter: IssueFilter!, $first: Int!) {
  issues(first: $first, after: $after, orderBy: updatedAt, filter: $filter) {
    nodes { id identifier title description url state { name } }
    pageInfo { hasNextPage endCursor }
  }
}`

function linearReadKey() {
  return process.env.DOVO_LINEAR_API_KEY?.trim()
}

export class LinearSettings {
  constructor(private readonly db: Database.Database) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS linear_connections (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, key TEXT NOT NULL, revision TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS linear_bindings (
        repository_id TEXT PRIMARY KEY, connection_id TEXT NOT NULL, team TEXT NOT NULL, revision TEXT NOT NULL
      );
    `)
  }
  connections(repositories: ReadonlySet<string>) {
    return decode(linearConnectionsSchema, {
      connections: this.db
        .prepare('SELECT id, name, revision FROM linear_connections ORDER BY name,id')
        .all(),
      bindings: this.db
        .prepare<[], { repositoryId: string }>(
          'SELECT repository_id AS repositoryId, connection_id AS connectionId, team, revision FROM linear_bindings ORDER BY repository_id',
        )
        .all()
        .filter((binding) => repositories.has(binding.repositoryId)),
    })
  }
  private connection(id: string) {
    return this.db
      .prepare<[string], { name: string; key: string; revision: string }>(
        'SELECT name,key,revision FROM linear_connections WHERE id=?',
      )
      .get(id)
  }
  private binding(repositoryId: string) {
    return this.db
      .prepare<[string], { connectionId: string; team: string; revision: string }>(
        'SELECT connection_id AS connectionId,team,revision FROM linear_bindings WHERE repository_id=?',
      )
      .get(repositoryId)
  }
  async configure(
    command: LinearConnectionCommand,
    projects: () => ReadonlySet<string>,
    authorize: () => void,
  ) {
    const repositories = projects()
    this.db.transaction(() => {
      const remove = this.db.prepare('DELETE FROM linear_bindings WHERE repository_id=?')
      for (const { id } of this.db
        .prepare<[], { id: string }>('SELECT repository_id AS id FROM linear_bindings')
        .all())
        if (!repositories.has(id)) remove.run(id)
    })()
    switch (command.action) {
      case 'save': {
        const key = checkedKey(command.key)
        const previous = this.connection(command.id)
        if (previous?.name === command.name && previous.key === key) break
        if (previous?.revision !== command.expectedRevision)
          throw new HttpError(409, 'The Linear connection changed. Reload and try again.')
        await readLinearIssues({}, key, 1)
        authorize()
        this.db.transaction(() => {
          const current = this.connection(command.id)
          if (current?.name === command.name && current.key === key) return
          if (current?.revision !== command.expectedRevision)
            throw new HttpError(409, 'The Linear connection changed. Reload and try again.')
          if (
            !current &&
            this.db.prepare('SELECT count(*) FROM linear_connections').pluck().get() === 20
          )
            throw new HttpError(409, 'This computer can save up to 20 Linear connections.')
          this.db
            .prepare(`
            INSERT INTO linear_connections VALUES (?,?,?,?)
            ON CONFLICT(id) DO UPDATE SET name=excluded.name,key=excluded.key,revision=excluded.revision
          `)
            .run(command.id, command.name, key, randomUUID())
        })()
        break
      }
      case 'remove': {
        const current = this.connection(command.id)
        if (!current) break
        if (current.revision !== command.expectedRevision)
          throw new HttpError(409, 'The Linear connection changed. Reload and try again.')
        if (
          this.db
            .prepare('SELECT 1 FROM linear_bindings WHERE connection_id=? LIMIT 1')
            .get(command.id)
        )
          throw new HttpError(409, 'Remove the project bindings for this Linear connection first.')
        this.db.prepare('DELETE FROM linear_connections WHERE id=?').run(command.id)
        break
      }
      case 'bind': {
        if (!repositories.has(command.repositoryId)) throw new HttpError(404, 'Project not found.')
        if (!this.connection(command.connectionId))
          throw new HttpError(404, 'Linear connection not found.')
        const current = this.binding(command.repositoryId)
        const team = command.team.toUpperCase()
        if (current?.connectionId === command.connectionId && current.team === team) break
        if (current?.revision !== command.expectedRevision)
          throw new HttpError(409, 'The Linear project binding changed. Reload and try again.')
        if (
          !current &&
          this.db.prepare('SELECT count(*) FROM linear_bindings').pluck().get() === 100
        )
          throw new HttpError(409, 'This computer can save up to 100 Linear project bindings.')
        this.db
          .prepare(`
          INSERT INTO linear_bindings VALUES (?,?,?,?)
          ON CONFLICT(repository_id) DO UPDATE SET connection_id=excluded.connection_id,team=excluded.team,revision=excluded.revision
        `)
          .run(command.repositoryId, command.connectionId, team, randomUUID())
        break
      }
      case 'unbind': {
        const current = this.binding(command.repositoryId)
        if (!current) break
        if (current.revision !== command.expectedRevision)
          throw new HttpError(409, 'The Linear project binding changed. Reload and try again.')
        this.db
          .prepare('DELETE FROM linear_bindings WHERE repository_id=?')
          .run(command.repositoryId)
        break
      }
    }
    return this.connections(projects())
  }
  async issues(input: typeof linearIssueQuerySchema.Type, hasProject: (id: string) => boolean) {
    const { repositoryId, connectionId } = input
    if (!repositoryId && !connectionId) return readLinearIssues(input, this.key())
    if (repositoryId && connectionId)
      throw new HttpError(400, 'Choose a Linear project or a connection.')
    const binding =
      repositoryId && hasProject(repositoryId) ? this.binding(repositoryId) : undefined
    const id = binding?.connectionId ?? connectionId
    const connection = id && this.connection(id)
    if (!id || !connection) throw new HttpError(404, 'This Linear source is unavailable.')
    const result = await readLinearIssues(input, connection.key, 25, binding?.team)
    if (
      this.connection(id)?.revision !== connection.revision ||
      (repositoryId &&
        (!hasProject(repositoryId) || this.binding(repositoryId)?.revision !== binding?.revision))
    )
      throw new HttpError(409, 'This Linear source changed. Select it again.')
    return result
  }
  private savedKey() {
    const key = this.db
      .prepare("SELECT value FROM documents WHERE id = 'linear-api-key'")
      .pluck()
      .get()
    return typeof key === 'string' ? key : undefined
  }
  key() {
    return this.savedKey() ?? linearReadKey()
  }
  source(): typeof linearKeySourceSchema.Type {
    return this.savedKey() ? 'saved' : linearReadKey() ? 'environment' : 'none'
  }
  async save(input: unknown, authorize: () => void) {
    const key = checkedKey(
      typeof input === 'object' && input !== null && 'key' in input && typeof input.key === 'string'
        ? input.key.trim()
        : '',
    )
    const previous = this.savedKey()
    await readLinearIssues({}, key, 1)
    authorize()
    if (this.savedKey() !== previous)
      throw new HttpError(409, 'The Linear key changed while testing. Try again.')
    this.db
      .prepare("INSERT OR REPLACE INTO documents (id, value) VALUES ('linear-api-key', ?)")
      .run(key)
  }
  remove() {
    this.db.prepare("DELETE FROM documents WHERE id = 'linear-api-key'").run()
  }
}

function checkedKey(input: string) {
  const key = input.trim()
  if (!/^[!-~]{1,512}$/.test(key)) throw new HttpError(400, 'Enter a valid Linear API key.')
  return key
}

export async function readLinearIssues(
  input: typeof linearIssueQuerySchema.Type,
  key = linearReadKey(),
  first = 25,
  team?: string,
) {
  if (!key) throw new HttpError(404, 'Linear is not configured on this computer.')
  const search = input.search?.trim()
  const identifier = search && /^([a-z][a-z0-9_]*)-([1-9][0-9]{0,8})$/i.exec(search)
  if (identifier && team && identifier[1].toUpperCase() !== team) return { items: [] }
  const filter = identifier
    ? { team: { key: { eq: identifier[1].toUpperCase() } }, number: { eq: Number(identifier[2]) } }
    : search
      ? { title: { containsIgnoreCase: search } }
      : {}
  const scoped = team ? { ...filter, team: { key: { eq: team } } } : filter
  let response: Response
  try {
    response = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { Authorization: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query,
        variables: { after: input.cursor ?? null, filter: scoped, first },
      }),
      redirect: 'error',
      signal: AbortSignal.timeout(12_000),
    })
  } catch {
    throw new HttpError(502, 'Could not reach Linear. Try again.')
  }
  if (response.status === 401 || response.status === 403)
    throw new HttpError(403, 'Linear rejected this computer’s API key.')
  if (response.status === 429)
    throw new HttpError(429, 'Linear rate limit reached. Try again later.')
  if (!response.ok) throw new HttpError(502, 'Linear could not load issues.')
  const result = await response
    .json()
    .then((body: unknown) => decode(responseSchema, body))
    .catch(() => {
      throw new HttpError(502, 'Linear returned an invalid issue list.')
    })
  if (result.errors?.length || !result.data)
    throw new HttpError(502, 'Linear could not read issues with this API key.')
  const { nodes, pageInfo } = result.data.issues
  return {
    items: nodes.flatMap(({ state, description, ...issue }) => {
      const url = URL.parse(issue.url)
      return url?.origin === 'https://linear.app' &&
        !url.username &&
        !url.password &&
        (!team || issue.identifier.toUpperCase().startsWith(team + '-'))
        ? [{ ...issue, status: state.name, description: description ?? '' }]
        : []
    }),
    next: pageInfo.hasNextPage ? (pageInfo.endCursor ?? undefined) : undefined,
  }
}
