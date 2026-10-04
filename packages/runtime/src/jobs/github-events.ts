import { z } from 'zod'
import { githubEventChoices, type GithubEvent, type GithubTrigger } from '@dovo/protocol'
import type { GitService } from '../scm/git/git.js'

const author = z.object({ login: z.string() }).nullable()
const itemSchema = z.object({
  id: z.string(),
  number: z.number(),
  title: z.string(),
  body: z.string(),
  url: z.string(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  author,
  headRefOid: z.string().optional(),
  state: z.enum(['OPEN', 'CLOSED', 'MERGED']).optional(),
  lastEditedAt: z.iso.datetime().nullable().optional(),
  editor: author.optional(),
})
type Item = z.infer<typeof itemSchema>
const eventSchema = z.object({
  id: z.string(),
  event: z.enum(githubEventChoices.map((choice) => choice.id)),
  at: z.iso.datetime(),
  actor: z.string(),
  context: z.record(z.string(), z.unknown()),
})
export const githubDeliverySchema = eventSchema
export type GithubDelivery = z.infer<typeof eventSchema>
const pageInfo = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() })
const connection = z.object({ nodes: z.array(z.unknown()), pageInfo })
const graphEnvelope = z.object({
  data: z.record(z.string(), z.unknown()).nullable().optional(),
  errors: z.array(z.object({ message: z.string() })).optional(),
})
const timelineSchema = z
  .object({
    __typename: z.string(),
    id: z.string().optional(),
    createdAt: z.iso.datetime().optional(),
    submittedAt: z.iso.datetime().nullable().optional(),
    actor: author.optional(),
    author: author.optional(),
  })
  .passthrough()
const commentSchema = z.object({
  id: z.string(),
  createdAt: z.iso.datetime(),
  author,
  body: z.string(),
  url: z.string(),
})
const timelineTypes: Partial<Record<GithubEvent, { type: string; fragment: string }>> = {
  'issue.comment': {
    type: 'ISSUE_COMMENT',
    fragment: '... on IssueComment { id createdAt author { login } body url }',
  },
  'pull_request.comment': {
    type: 'ISSUE_COMMENT',
    fragment: '... on IssueComment { id createdAt author { login } body url }',
  },
  'issue.assigned': {
    type: 'ASSIGNED_EVENT',
    fragment:
      '... on AssignedEvent { id createdAt actor { login } assignee { ... on User { login } ... on Bot { login } } }',
  },
  'pull_request.assigned': {
    type: 'ASSIGNED_EVENT',
    fragment:
      '... on AssignedEvent { id createdAt actor { login } assignee { ... on User { login } ... on Bot { login } } }',
  },
  'issue.labeled': {
    type: 'LABELED_EVENT',
    fragment: '... on LabeledEvent { id createdAt actor { login } label { name } }',
  },
  'pull_request.labeled': {
    type: 'LABELED_EVENT',
    fragment: '... on LabeledEvent { id createdAt actor { login } label { name } }',
  },
  'pull_request.merged': {
    type: 'MERGED_EVENT',
    fragment: '... on MergedEvent { id createdAt actor { login } commit { oid } }',
  },
  'pull_request.ready_for_review': {
    type: 'READY_FOR_REVIEW_EVENT',
    fragment: '... on ReadyForReviewEvent { id createdAt actor { login } }',
  },
  'pull_request.review_requested': {
    type: 'REVIEW_REQUESTED_EVENT',
    fragment:
      '... on ReviewRequestedEvent { id createdAt actor { login } requestedReviewer { ... on User { login } ... on Team { slug } ... on Bot { login } } }',
  },
  'pull_request.review_submitted': {
    type: 'PULL_REQUEST_REVIEW',
    fragment: '... on PullRequestReview { id submittedAt author { login } body state url }',
  },
  'sub_issue.added': {
    type: 'SUB_ISSUE_ADDED_EVENT',
    fragment:
      '... on SubIssueAddedEvent { id createdAt actor { login } subIssue { number title url } }',
  },
}
const itemFields = 'id number title body url createdAt updatedAt author { login }'

/** Uses the same gh executable, host credentials and rate-limit admission as SCM. */
export class GithubEvents {
  private disposed = false
  constructor(private git: Pick<GitService, 'githubAccount'>) {}
  dispose() {
    this.disposed = true
  }
  private async request(args: string[]) {
    if (this.disposed) throw new Error('GitHub polling stopped')
    const result = await this.git.githubAccount(args)
    if (this.disposed) throw new Error('GitHub polling stopped')
    return result
  }
  private async graphql(config: GithubTrigger, query: string) {
    const result = graphEnvelope.parse(
      JSON.parse(
        await this.request(['api', '--hostname', config.host, 'graphql', '-f', `query=${query}`]),
      ),
    )
    if (result.errors?.length)
      throw new Error(result.errors.map((error) => error.message).join('; '))
    if (!result.data) throw new Error('GitHub returned no data')
    return result.data
  }
  private async pages(
    config: GithubTrigger,
    query: (cursor: string | null) => string,
    read: (data: Record<string, unknown>) => unknown,
    visit: (nodes: unknown[]) => Promise<boolean>,
  ) {
    let cursor: string | null = null
    const cursors = new Set<string>()
    do {
      const page = connection.parse(read(await this.graphql(config, query(cursor))))
      if (!(await visit(page.nodes)) || !page.pageInfo.hasNextPage) return
      cursor = page.pageInfo.endCursor
      if (!cursor || cursors.has(cursor))
        throw new Error('GitHub returned an invalid pagination cursor')
      cursors.add(cursor)
    } while (cursor)
  }
  async collect(
    config: GithubTrigger,
    since: string,
    until: string,
    heads: Record<string, string>,
  ) {
    const deliveries: GithubDelivery[] = []
    const nextHeads = { ...heads }
    const add = (item: Item, id: string, at: string, actor: string, detail: unknown) => {
      if (Date.parse(at) < Date.parse(since) || Date.parse(at) > Date.parse(until)) return
      if (config.actor && config.actor.toLowerCase() !== actor.toLowerCase()) return
      deliveries.push({
        id,
        event: config.event,
        at,
        actor,
        context: { repository: `${config.host}/${config.repository}`, item, detail },
      })
    }
    const [owner, name] = config.repository.split('/')
    const scope = `repository(owner:${JSON.stringify(owner)}, name:${JSON.stringify(name)})`
    const discussion = config.event.startsWith('discussion.')
    const pull = config.event.startsWith('pull_request.')
    const collection = discussion ? 'discussions' : pull ? 'pullRequests' : 'issues'
    const extra = pull ? 'headRefOid state' : discussion ? 'lastEditedAt editor { login }' : ''
    const baseline = config.event === 'pull_request.synchronized' && !Object.keys(heads).length
    const items: Item[] = []
    await this.pages(
      config,
      (cursor) => `query { ${scope} {
      items: ${collection}(first:100${baseline ? ', states:[OPEN]' : ''}, after:${JSON.stringify(cursor)}, orderBy:{field:UPDATED_AT,direction:DESC}) {
        nodes { ${itemFields} ${extra} } pageInfo { hasNextPage endCursor }
      } } }`,
      (data) => z.object({ items: z.unknown() }).parse(data.repository).items,
      async (nodes) => {
        const page = nodes.map((node) => itemSchema.parse(node))
        items.push(
          ...page.filter((item) => baseline || Date.parse(item.updatedAt) >= Date.parse(since)),
        )
        return baseline || page.every((item) => Date.parse(item.updatedAt) >= Date.parse(since))
      },
    )
    for (const item of items) {
      if (config.event === 'pull_request.synchronized' && item.state && item.state !== 'OPEN') {
        delete nextHeads[item.id]
        continue
      }
      if (config.event === 'pull_request.synchronized' && item.headRefOid)
        nextHeads[item.id] = item.headRefOid
      if (config.label) {
        let matches = false
        await this.pages(
          config,
          (cursor) => `query { node(id:${JSON.stringify(item.id)}) {
          ... on ${discussion ? 'Discussion' : pull ? 'PullRequest' : 'Issue'} { labels(first:100,after:${JSON.stringify(cursor)}) {
            nodes { name } pageInfo { hasNextPage endCursor }
          } } } }`,
          (data) => z.object({ labels: z.unknown() }).parse(data.node).labels,
          async (nodes) => {
            matches ||= nodes.some(
              (node) => z.object({ name: z.string() }).parse(node).name === config.label,
            )
            return !matches
          },
        )
        if (!matches) continue
      }
      if (['issue.created', 'pull_request.opened', 'discussion.opened'].includes(config.event))
        add(item, `${item.id}:opened`, item.createdAt, item.author?.login ?? '', item)
      else if (config.event === 'discussion.updated') {
        if (item.lastEditedAt)
          add(
            item,
            `${item.id}:updated:${item.lastEditedAt}`,
            item.lastEditedAt,
            item.editor?.login ?? '',
            item,
          )
      } else if (config.event === 'pull_request.synchronized') {
        if (item.headRefOid) {
          const previous = heads[item.id]
          if (previous && previous !== item.headRefOid)
            add(item, `${item.id}:head:${until}:${previous}:${item.headRefOid}`, until, '', {
              before: previous,
              after: item.headRefOid,
            })
        }
      } else if (config.event === 'discussion.comment') {
        await this.pages(
          config,
          (cursor) => `query { node(id:${JSON.stringify(item.id)}) {
          ... on Discussion { comments(first:100,after:${JSON.stringify(cursor)}) {
            nodes { id createdAt author { login } body url } pageInfo { hasNextPage endCursor }
          } } } }`,
          (data) => z.object({ comments: z.unknown() }).parse(data.node).comments,
          async (nodes) => {
            for (const raw of nodes) {
              const comment = commentSchema.parse(raw)
              add(item, comment.id, comment.createdAt, comment.author?.login ?? '', comment)
              await this.pages(
                config,
                (cursor) => `query { node(id:${JSON.stringify(comment.id)}) {
                ... on DiscussionComment { replies(first:100,after:${JSON.stringify(cursor)}) {
                  nodes { id createdAt author { login } body url } pageInfo { hasNextPage endCursor }
                } } } }`,
                (data) => z.object({ replies: z.unknown() }).parse(data.node).replies,
                async (replies) => {
                  for (const raw of replies) {
                    const reply = commentSchema.parse(raw)
                    add(item, reply.id, reply.createdAt, reply.author?.login ?? '', reply)
                  }
                  return true
                },
              )
            }
            return true
          },
        )
      } else if (config.event === 'pull_request.review_comment') {
        for (let page = 1; ; page++) {
          const comments = z
            .array(
              z.object({
                id: z.number(),
                created_at: z.iso.datetime(),
                user: author,
                body: z.string(),
                html_url: z.string(),
                path: z.string(),
              }),
            )
            .parse(
              JSON.parse(
                await this.request([
                  'api',
                  '--hostname',
                  config.host,
                  `repos/${config.repository}/pulls/${item.number}/comments?per_page=100&page=${page}`,
                ]),
              ),
            )
          for (const comment of comments)
            add(
              item,
              `review-comment:${comment.id}`,
              comment.created_at,
              comment.user?.login ?? '',
              comment,
            )
          if (comments.length < 100) break
        }
      } else {
        const timeline = timelineTypes[config.event]
        if (!timeline) throw new Error(`Unsupported GitHub event: ${config.event}`)
        await this.pages(
          config,
          (cursor) => `query { node(id:${JSON.stringify(item.id)}) {
          ... on ${pull ? 'PullRequest' : 'Issue'} {
            timelineItems(first:100,after:${JSON.stringify(cursor)},since:${JSON.stringify(since)},itemTypes:[${timeline.type}]) {
              nodes { __typename ${timeline.fragment} } pageInfo { hasNextPage endCursor }
            } } } }`,
          (data) => z.object({ timelineItems: z.unknown() }).parse(data.node).timelineItems,
          async (nodes) => {
            for (const raw of nodes) {
              const event = timelineSchema.parse(raw)
              const at = event.submittedAt ?? event.createdAt
              if (event.id && at)
                add(item, event.id, at, (event.actor ?? event.author)?.login ?? '', event)
            }
            return true
          },
        )
      }
    }
    const allowed: GithubDelivery[] = []
    const permissions = new Map<string, boolean>()
    for (const delivery of deliveries) {
      if (config.requireWriteAccess) {
        // Head changes expose no actor.
        // Fail closed for events for which polling cannot establish the triggering actor.
        if (!delivery.actor) continue
        let write = permissions.get(delivery.actor)
        if (write === undefined) {
          const permission = z
            .object({ permission: z.string() })
            .parse(
              JSON.parse(
                await this.request([
                  'api',
                  '--hostname',
                  config.host,
                  `repos/${config.repository}/collaborators/${encodeURIComponent(delivery.actor)}/permission`,
                ]),
              ),
            )
          write = ['admin', 'maintain', 'write'].includes(permission.permission)
          permissions.set(delivery.actor, write)
        }
        if (!write) continue
      }
      allowed.push(delivery)
    }
    return {
      deliveries: allowed.sort(
        (a, b) => Date.parse(a.at) - Date.parse(b.at) || a.id.localeCompare(b.id),
      ),
      heads: nextHeads,
    }
  }
}
