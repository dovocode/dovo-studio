import { z } from 'zod'
import {
  pullActionSchema,
  pullActionResultSchema,
  pullCreateSchema,
  type PullAction,
  type PullCreate,
} from '@dovo/protocol'
import { HttpError } from '../errors.js'
import { githubApi, githubGraphql, type GithubJSON, type GithubLocation } from './github-api.js'

const pull = z.object({
  number: z.number().int().positive(),
  html_url: z.url(),
  head: z.object({ sha: z.string() }),
})
const responseURL = z.object({ html_url: z.url() })

export async function createGithubPull(json: GithubJSON, repo: GithubLocation, value: PullCreate) {
  const input = pullCreateSchema.parse(value)
  const result = z
    .object({ number: z.number().int().positive(), html_url: z.url() })
    .parse(
      await githubApi(json, repo, 'pulls', 'POST', [
        '-f',
        `title=${input.title}`,
        '-f',
        `body=${input.body}`,
        '-f',
        `head=${input.head}`,
        '-f',
        `base=${input.base}`,
        '-F',
        `draft=${input.draft}`,
      ]),
    )
  return pullActionResultSchema.parse({
    number: result.number,
    url: result.html_url,
    status: 'created',
  })
}

export async function actOnGithubPull(json: GithubJSON, repo: GithubLocation, value: PullAction) {
  const input = pullActionSchema.parse(value)
  if (input.action === 'review' && input.event !== 'approve' && !input.body)
    throw new HttpError(400, 'Write a review before commenting or requesting changes.')
  if (input.action === 'reviewers' && !input.reviewers.length && !input.teams.length)
    throw new HttpError(400, 'Choose at least one user or team to request a review.')
  const current = pull.parse(await githubApi(json, repo, `pulls/${input.number}`))
  if (current.number !== input.number || current.head.sha !== input.headSha)
    throw new HttpError(409, 'This PR changed. Refresh before continuing.')
  const endpoint = `pulls/${input.number}`
  const result = { number: input.number, url: current.html_url }
  switch (input.action) {
    case 'comment': {
      const posted = responseURL.parse(
        await githubApi(json, repo, `issues/${input.number}/comments`, 'POST', [
          '-f',
          `body=${input.body}`,
        ]),
      )
      return pullActionResultSchema.parse({ ...result, url: posted.html_url, status: 'submitted' })
    }
    case 'review': {
      const event = {
        comment: 'COMMENT',
        approve: 'APPROVE',
        'request-changes': 'REQUEST_CHANGES',
      }[input.event]
      const posted = responseURL.parse(
        await githubApi(json, repo, `${endpoint}/reviews`, 'POST', [
          '-f',
          `body=${input.body}`,
          '-f',
          `event=${event}`,
          '-f',
          `commit_id=${input.headSha}`,
        ]),
      )
      return pullActionResultSchema.parse({ ...result, url: posted.html_url, status: 'submitted' })
    }
    case 'reply': {
      const id = z
        .string()
        .regex(/^(?:inline-)?[1-9]\d*$/, 'Choose an inline review comment to reply to')
        .parse(input.commentId)
        .replace(/^inline-/, '')
      const original = z
        .object({
          id: z.number().int().positive(),
          in_reply_to_id: z.number().int().positive().optional(),
          pull_request_url: z.url(),
        })
        .parse(await githubApi(json, repo, `pulls/comments/${id}`))
      // A comment ID is repository-global. Verify membership before posting, and
      // always reply to the root: GitHub does not support replies to replies.
      const expectedPath = `/${repo.path}/pulls/${input.number}`
      if (!new URL(original.pull_request_url).pathname.endsWith(expectedPath))
        throw new HttpError(400, 'This comment belongs to another pull request.')
      const root = original.in_reply_to_id ?? original.id
      const posted = responseURL.parse(
        await githubApi(json, repo, `${endpoint}/comments/${root}/replies`, 'POST', [
          '-f',
          `body=${input.body}`,
        ]),
      )
      return pullActionResultSchema.parse({ ...result, url: posted.html_url, status: 'submitted' })
    }
    case 'resolve': {
      const value = z
        .object({
          data: z.object({
            node: z.object({
              __typename: z.literal('PullRequestReviewThread'),
              isResolved: z.boolean(),
              viewerCanResolve: z.boolean(),
              viewerCanUnresolve: z.boolean(),
              pullRequest: z.object({
                number: z.number(),
                repository: z.object({ nameWithOwner: z.string() }),
              }),
            }),
          }),
        })
        .parse(
          await githubGraphql(
            json,
            repo,
            'query($id:ID!){node(id:$id){__typename ... on PullRequestReviewThread{isResolved viewerCanResolve viewerCanUnresolve pullRequest{number repository{nameWithOwner}}}}}',
            ['-f', `id=${input.threadId}`],
          ),
        ).data.node
      if (
        value.pullRequest.number !== input.number ||
        value.pullRequest.repository.nameWithOwner.toLowerCase() !==
          repo.nameWithOwner.toLowerCase()
      )
        throw new HttpError(400, 'This thread belongs to another pull request.')
      if (value.isResolved !== input.resolved) {
        if (!(input.resolved ? value.viewerCanResolve : value.viewerCanUnresolve))
          throw new HttpError(403, 'Your GitHub account cannot change this thread’s resolution.')
        const mutation = input.resolved ? 'resolveReviewThread' : 'unresolveReviewThread'
        const changed = z
          .object({
            data: z.record(
              z.string(),
              z.object({ thread: z.object({ id: z.string(), isResolved: z.boolean() }) }),
            ),
          })
          .parse(
            await githubGraphql(
              json,
              repo,
              `mutation($id:ID!){${mutation}(input:{threadId:$id}){thread{id isResolved}}}`,
              ['-f', `id=${input.threadId}`],
            ),
          ).data[mutation]?.thread
        if (changed?.id !== input.threadId || changed.isResolved !== input.resolved)
          throw new Error(
            'GitHub did not confirm the requested thread state. Refresh before retrying.',
          )
      }
      return pullActionResultSchema.parse({ ...result, status: 'updated' })
    }
    case 'edit':
      await githubApi(json, repo, endpoint, 'PATCH', [
        '-f',
        `title=${input.title}`,
        '-f',
        `body=${input.body}`,
        ...(input.base ? ['-f', `base=${input.base}`] : []),
      ])
      break
    case 'reviewers':
      await githubApi(
        json,
        repo,
        `${endpoint}/requested_reviewers`,
        input.operation === 'remove' ? 'DELETE' : 'POST',
        [
          ...input.reviewers.flatMap((name) => ['-f', `reviewers[]=${name}`]),
          ...input.teams.flatMap((name) => ['-f', `team_reviewers[]=${name}`]),
        ],
      )
      break
    case 'merge': {
      const merged = z
        .object({ merged: z.boolean(), message: z.string().optional() })
        .parse(
          await githubApi(json, repo, `${endpoint}/merge`, 'PUT', [
            '-f',
            `sha=${input.headSha}`,
            '-f',
            `merge_method=${input.method}`,
            ...(input.message ? ['-f', `commit_message=${input.message}`] : []),
          ]),
        )
      if (!merged.merged)
        throw new HttpError(
          409,
          merged.message ||
            'GitHub did not merge this pull request. Refresh its checks and branch requirements.',
        )
      return pullActionResultSchema.parse({ ...result, status: 'merged', message: merged.message })
    }
    case 'close':
    case 'reopen':
      await githubApi(json, repo, endpoint, 'PATCH', [
        '-f',
        `state=${input.action === 'close' ? 'closed' : 'open'}`,
      ])
      break
  }
  return pullActionResultSchema.parse({ ...result, status: 'updated' })
}
