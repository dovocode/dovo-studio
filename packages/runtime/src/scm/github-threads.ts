import { z } from 'zod'
import type { PullComment } from '@dovo/protocol'
import { githubGraphql, type GithubJSON, type GithubLocation } from './github-api.js'

const pageInfo = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() })
const comments = z.object({
  nodes: z.array(z.object({ databaseId: z.number().int().positive().nullable() }).nullable()),
  pageInfo,
})
const thread = z.object({
  id: z.string(),
  isResolved: z.boolean(),
  isOutdated: z.boolean(),
  viewerCanResolve: z.boolean(),
  viewerCanUnresolve: z.boolean(),
  comments,
})
const commentFields = 'comments(first:100){nodes{databaseId} pageInfo{hasNextPage endCursor}}'
const threadFields = `id isResolved isOutdated viewerCanResolve viewerCanUnresolve ${commentFields}`
type ThreadMetadata = Pick<PullComment, 'threadId' | 'resolved' | 'outdated' | 'canResolve'>

function nextCursor(page: z.infer<typeof pageInfo>, seen: Set<string>) {
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
    const response = z
      .object({
        data: z.object({
          repository: z.object({
            pullRequest: z.object({
              reviewThreads: z.object({ nodes: z.array(thread.nullable()), pageInfo }),
            }),
          }),
        }),
      })
      .parse(
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
      const record = (nodes: z.infer<typeof comments>['nodes']) => {
        for (const comment of nodes)
          if (comment?.databaseId) result.set(`inline-${comment.databaseId}`, metadata)
      }
      record(value.comments.nodes)
      const commentCursors = new Set<string>()
      let commentCursor = nextCursor(value.comments.pageInfo, commentCursors)
      while (commentCursor) {
        const continuation = z
          .object({ data: z.object({ node: z.object({ comments }) }) })
          .parse(
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
