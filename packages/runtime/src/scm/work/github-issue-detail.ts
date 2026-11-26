import { decode, mutableArray, mutableStruct, type ForgeIssueDetail } from '@dovo/protocol'
import { Schema } from 'effect'
import { HttpError } from '../../errors.js'
import type { WorkHttp } from './forge-work-types.js'

const author = Schema.NullOr(mutableStruct({ login: Schema.String }))
const issue = mutableStruct({
  title: Schema.String,
  body: Schema.String,
  state: Schema.Literals(['OPEN', 'CLOSED']),
  url: Schema.String,
  author,
  updatedAt: Schema.String,
  assignees: mutableStruct({ nodes: mutableArray(author) }),
  labels: Schema.NullOr(
    mutableStruct({ nodes: mutableArray(Schema.NullOr(mutableStruct({ name: Schema.String }))) }),
  ),
  comments: mutableStruct({
    nodes: mutableArray(
      Schema.NullOr(
        mutableStruct({
          id: Schema.String,
          databaseId: Schema.NullOr(Schema.Number),
          body: Schema.String,
          author,
          createdAt: Schema.String,
          url: Schema.String,
        }),
      ),
    ),
    pageInfo: mutableStruct({
      hasNextPage: Schema.Boolean,
      endCursor: Schema.NullOr(Schema.String),
    }),
  }),
})
const envelope = mutableStruct({
  errors: Schema.optional(mutableArray(mutableStruct({ type: Schema.optional(Schema.String) }))),
  data: Schema.optional(
    Schema.NullOr(
      mutableStruct({ repository: Schema.NullOr(mutableStruct({ item: Schema.Unknown })) }),
    ),
  ),
})
const kind = mutableStruct({ __typename: Schema.String })
export const githubIssueCursorPrefix = 'github:'

const query = `query DovoIssue($owner: String!, $repo: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $repo) {
    item: issueOrPullRequest(number: $number) {
      __typename
      ... on Issue {
        title body state url author { login } updatedAt
        assignees(first: 100) { nodes { login } }
        labels(first: 100) { nodes { name } }
        comments(first: 50, after: $after) {
          nodes { id databaseId body author { login } createdAt url }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }
}`

export async function readGitHubIssue(
  http: WorkHttp,
  repository: string,
  number: number,
  cursor?: string,
): Promise<ForgeIssueDetail> {
  const [owner, repo] = repository.split('/')
  const result = decode(
    envelope,
    await http.json('graphql', {
      method: 'POST',
      body: {
        query,
        variables: {
          owner,
          repo,
          number,
          after: cursor?.slice(githubIssueCursorPrefix.length) ?? null,
        },
      },
    }),
  )
  if (result.errors?.length) {
    if (result.errors.every((error) => error.type === 'NOT_FOUND'))
      throw new HttpError(404, 'GitHub issue not found')
    throw new HttpError(502, 'GitHub could not load the complete issue.')
  }
  const item = result.data?.repository?.item
  if (!item) throw new HttpError(404, 'GitHub issue not found')
  if (decode(kind, item).__typename === 'PullRequest')
    throw new HttpError(400, 'This item is a pull request. Use the PR view.')
  const value = decode(issue, item)
  const { hasNextPage, endCursor } = value.comments.pageInfo
  return {
    issue: {
      id: String(number),
      title: value.title,
      body: value.body,
      state: value.state.toLowerCase(),
      type: 'Issue',
      url: value.url,
      author: value.author?.login ?? 'Deleted user',
      assignees: value.assignees.nodes.flatMap((node) => (node ? [node.login] : [])),
      labels: (value.labels?.nodes ?? []).flatMap((node) => (node ? [node.name] : [])),
      updatedAt: value.updatedAt,
      revision: value.updatedAt,
      bodyFormat: 'markdown',
    },
    comments: value.comments.nodes.flatMap((node) =>
      node
        ? [
            {
              id: String(node.databaseId ?? node.id),
              body: node.body,
              author: node.author?.login ?? 'Deleted user',
              createdAt: node.createdAt,
              url: node.url,
              bodyFormat: 'markdown' as const,
            },
          ]
        : [],
    ),
    next: hasNextPage && endCursor ? githubIssueCursorPrefix + endCursor : undefined,
  }
}
