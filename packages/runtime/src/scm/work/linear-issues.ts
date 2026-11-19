import { Schema } from 'effect'
import { decode, linearIssueQuerySchema, mutableArray, mutableStruct } from '@dovo/protocol'
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
  constructor(private readonly db: Database.Database) {}
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
    const key =
      typeof input === 'object' && input !== null && 'key' in input && typeof input.key === 'string'
        ? input.key.trim()
        : ''
    if (!/^[!-~]{1,512}$/.test(key)) throw new HttpError(400, 'Enter a valid Linear API key.')
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

export async function readLinearIssues(
  input: typeof linearIssueQuerySchema.Type,
  key = linearReadKey(),
  first = 25,
) {
  if (!key) throw new HttpError(404, 'Linear is not configured on this computer.')
  const search = input.search?.trim()
  const identifier = search && /^([a-z][a-z0-9_]*)-([1-9][0-9]{0,8})$/i.exec(search)
  const filter = identifier
    ? { team: { key: { eq: identifier[1].toUpperCase() } }, number: { eq: Number(identifier[2]) } }
    : search
      ? { title: { containsIgnoreCase: search } }
      : {}
  let response: Response
  try {
    response = await fetch('https://api.linear.app/graphql', {
      method: 'POST',
      headers: { Authorization: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { after: input.cursor ?? null, filter, first } }),
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
      return url?.origin === 'https://linear.app' && !url.username && !url.password
        ? [{ ...issue, status: state.name, description: description ?? '' }]
        : []
    }),
    next: pageInfo.hasNextPage ? (pageInfo.endCursor ?? undefined) : undefined,
  }
}
