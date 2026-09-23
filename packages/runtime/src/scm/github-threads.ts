import { mutableStruct, mutableArray } from '@dovo/protocol'
import { decode } from '@dovo/protocol'
import { Schema } from 'effect'
import type { PullComment } from '@dovo/protocol'
import { githubGraphql, type GithubJSON, type GithubLocation } from './github-api.js'
const pageInfo = mutableStruct({
  hasNextPage: Schema.Boolean,
  endCursor: Schema.NullOr(Schema.String),
})
const comments = mutableStruct({
  nodes: mutableArray(
    Schema.NullOr(
      mutableStruct({
        databaseId: Schema.NullOr(
          Schema.Number.pipe(Schema.finite())
            .pipe(Schema.int(), Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER))
            .pipe(Schema.positive()),
        ),
      }),
    ),
  ),
  pageInfo,
})
const thread = mutableStruct({
  id: Schema.String,
  isResolved: Schema.Boolean,
  isOutdated: Schema.Boolean,
  viewerCanResolve: Schema.Boolean,
  viewerCanUnresolve: Schema.Boolean,
  comments,
})
const commentFields = 'comments(first:100){nodes{databaseId} pageInfo{hasNextPage endCursor}}'
const threadFields = `id isResolved isOutdated viewerCanResolve viewerCanUnresolve ${commentFields}`
type ThreadMetadata = Pick<PullComment, 'threadId' | 'resolved' | 'outdated' | 'canResolve'>
function nextCursor(page: Schema.Schema.Type<typeof pageInfo>, seen: Set<string>) {
  if (!page.hasNextPage) return undefined
  if (!page.endCursor || seen.has(page.endCursor))
    throw new Error('GitHub returned an invalid review thread cursor')
  seen.add(page.endCursor)
  return page.endCursor
}
export async function githubThreads(json: GithubJSON, repo: GithubLocation, number: number) {
  const [owner, name] = repo.nameWithOwner.split('/')
  const result = new Map<string, ThreadMetadata>()
  const seen = new Set<string>()
  let cursor: string | undefined
  do {
    const response = decode(
      mutableStruct({
        data: mutableStruct({
          repository: mutableStruct({
            pullRequest: mutableStruct({
              reviewThreads: mutableStruct({
                nodes: mutableArray(Schema.NullOr(thread)),
                pageInfo,
              }),
            }),
          }),
        }),
      }),
      await githubGraphql(
        json,
        repo,
        `query($owner:String!,$name:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){reviewThreads(first:100,after:$cursor){nodes{${threadFields}} pageInfo{hasNextPage endCursor}}}}}`,
        [
          '-f',
          `owner=${owner}`,
          '-f',
          `name=${name}`,
          '-F',
          `number=${number}`,
          ...(cursor ? ['-f', `cursor=${cursor}`] : []),
        ],
      ),
    )
    const page = response.data.repository.pullRequest.reviewThreads
    for (const value of page.nodes) {
      if (!value) continue
      const metadata: ThreadMetadata = {
        threadId: value.id,
        resolved: value.isResolved,
        outdated: value.isOutdated,
        canResolve: value.isResolved ? value.viewerCanUnresolve : value.viewerCanResolve,
      }
      const record = (nodes: Schema.Schema.Type<typeof comments>['nodes']) => {
        for (const comment of nodes)
          if (comment?.databaseId) result.set(`inline-${comment.databaseId}`, metadata)
      }
      record(value.comments.nodes)
      const commentCursors = new Set<string>()
      let commentCursor = nextCursor(value.comments.pageInfo, commentCursors)
      while (commentCursor) {
        const continuation = decode(
          mutableStruct({
            data: mutableStruct({
              node: mutableStruct({
                comments,
              }),
            }),
          }),
          await githubGraphql(
            json,
            repo,
            'query($id:ID!,$cursor:String!){node(id:$id){... on PullRequestReviewThread{comments(first:100,after:$cursor){nodes{databaseId} pageInfo{hasNextPage endCursor}}}}}',
            ['-f', `id=${value.id}`, '-f', `cursor=${commentCursor}`],
          ),
        ).data.node.comments
        record(continuation.nodes)
        commentCursor = nextCursor(continuation.pageInfo, commentCursors)
      }
    }
    cursor = nextCursor(page.pageInfo, seen)
  } while (cursor)
  return result
}
