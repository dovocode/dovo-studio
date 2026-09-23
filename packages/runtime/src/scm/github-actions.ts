import { mutableStruct } from '@dovo/protocol'
import { urlSchema, decode } from '@dovo/protocol'
import { Schema } from 'effect'
import {
  pullActionSchema,
  pullActionResultSchema,
  pullCreateSchema,
  type PullAction,
  type PullCreate,
} from '@dovo/protocol'
import { HttpError } from '../errors.js'
import { githubApi, githubGraphql, type GithubJSON, type GithubLocation } from './github-api.js'
const pull = mutableStruct({
  number: Schema.Number.pipe(Schema.finite())
    .pipe(Schema.int(), Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER))
    .pipe(Schema.positive()),
  html_url: urlSchema(),
  head: mutableStruct({
    sha: Schema.String,
  }),
})
const responseURL = mutableStruct({
  html_url: urlSchema(),
})
export async function createGithubPull(json: GithubJSON, repo: GithubLocation, value: PullCreate) {
  const input = decode(pullCreateSchema, value)
  const result = decode(
    mutableStruct({
      number: Schema.Number.pipe(Schema.finite())
        .pipe(Schema.int(), Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER))
        .pipe(Schema.positive()),
      html_url: urlSchema(),
    }),
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
  return decode(pullActionResultSchema, {
    number: result.number,
    url: result.html_url,
    status: 'created',
  })
}
export async function actOnGithubPull(json: GithubJSON, repo: GithubLocation, value: PullAction) {
  const input = decode(pullActionSchema, value)
  if (input.action === 'review' && input.event !== 'approve' && !input.body)
    throw new HttpError(400, 'Write a review before commenting or requesting changes.')
  if (input.action === 'reviewers' && !input.reviewers.length && !input.teams.length)
    throw new HttpError(400, 'Choose at least one user or team to request a review.')
  const current = decode(pull, await githubApi(json, repo, `pulls/${input.number}`))
  if (current.number !== input.number || current.head.sha !== input.headSha)
    throw new HttpError(409, 'This PR changed. Refresh before continuing.')
  const endpoint = `pulls/${input.number}`
  const result = {
    number: input.number,
    url: current.html_url,
  }
  switch (input.action) {
    case 'comment': {
      const posted = decode(
        responseURL,
        await githubApi(json, repo, `issues/${input.number}/comments`, 'POST', [
          '-f',
          `body=${input.body}`,
        ]),
      )
      return decode(pullActionResultSchema, {
        ...result,
        url: posted.html_url,
        status: 'submitted',
      })
    }
    case 'review': {
      const event = {
        comment: 'COMMENT',
        approve: 'APPROVE',
        'request-changes': 'REQUEST_CHANGES',
      }[input.event]
      const posted = decode(
        responseURL,
        await githubApi(json, repo, `${endpoint}/reviews`, 'POST', [
          '-f',
          `body=${input.body}`,
          '-f',
          `event=${event}`,
          '-f',
          `commit_id=${input.headSha}`,
        ]),
      )
      return decode(pullActionResultSchema, {
        ...result,
        url: posted.html_url,
        status: 'submitted',
      })
    }
    case 'reply': {
      const id = decode(
        Schema.String.pipe(Schema.pattern(/^(?:inline-)?[1-9]\d*$/)),
        input.commentId,
      ).replace(/^inline-/, '')
      const original = decode(
        mutableStruct({
          id: Schema.Number.pipe(Schema.finite())
            .pipe(Schema.int(), Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER))
            .pipe(Schema.positive()),
          in_reply_to_id: Schema.optional(
            Schema.Number.pipe(Schema.finite())
              .pipe(Schema.int(), Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER))
              .pipe(Schema.positive()),
          ),
          pull_request_url: urlSchema(),
        }),
        await githubApi(json, repo, `pulls/comments/${id}`),
      )
      // A comment ID is repository-global. Verify membership before posting, and
      // always reply to the root: GitHub does not support replies to replies.
      const expectedPath = `/${repo.path}/pulls/${input.number}`
      if (!new URL(original.pull_request_url).pathname.endsWith(expectedPath))
        throw new HttpError(400, 'This comment belongs to another pull request.')
      const root = original.in_reply_to_id ?? original.id
      const posted = decode(
        responseURL,
        await githubApi(json, repo, `${endpoint}/comments/${root}/replies`, 'POST', [
          '-f',
          `body=${input.body}`,
        ]),
      )
      return decode(pullActionResultSchema, {
        ...result,
        url: posted.html_url,
        status: 'submitted',
      })
    }
    case 'resolve': {
      const value = decode(
        mutableStruct({
          data: mutableStruct({
            node: mutableStruct({
              __typename: Schema.Literal('PullRequestReviewThread'),
              isResolved: Schema.Boolean,
              viewerCanResolve: Schema.Boolean,
              viewerCanUnresolve: Schema.Boolean,
              pullRequest: mutableStruct({
                number: Schema.Number.pipe(Schema.finite()),
                repository: mutableStruct({
                  nameWithOwner: Schema.String,
                }),
              }),
            }),
          }),
        }),
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
        const changed = decode(
          mutableStruct({
            data: Schema.mutable(
              Schema.Record({
                key: Schema.String,
                value: mutableStruct({
                  thread: mutableStruct({
                    id: Schema.String,
                    isResolved: Schema.Boolean,
                  }),
                }),
              }),
            ),
          }),
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
      return decode(pullActionResultSchema, {
        ...result,
        status: 'updated',
      })
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
      const merged = decode(
        mutableStruct({
          merged: Schema.Boolean,
          message: Schema.optional(Schema.String),
        }),
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
      return decode(pullActionResultSchema, {
        ...result,
        status: 'merged',
        message: merged.message,
      })
    }
    case 'close':
    case 'reopen':
      await githubApi(json, repo, endpoint, 'PATCH', [
        '-f',
        `state=${input.action === 'close' ? 'closed' : 'open'}`,
      ])
      break
  }
  return decode(pullActionResultSchema, {
    ...result,
    status: 'updated',
  })
}
