import { Schema } from 'effect'
import { decode, mutableStruct, type PullAction } from '@dovo/protocol'
import { HttpError } from '../../../errors.js'
import { githubGraphql, type GithubJSON, type GithubLocation } from './github-api.js'

const lifecycle = mutableStruct({
  id: Schema.String,
  headRefOid: Schema.String,
  state: Schema.Literals(['OPEN', 'CLOSED', 'MERGED']),
  isDraft: Schema.Boolean,
  mergeStateStatus: Schema.String,
  isInMergeQueue: Schema.Boolean,
  viewerCanUpdate: Schema.Boolean,
  viewerCanEnableAutoMerge: Schema.Boolean,
  viewerCanDisableAutoMerge: Schema.Boolean,
  autoMergeRequest: Schema.NullOr(mutableStruct({ mergeMethod: Schema.String })),
})

export async function githubLifecycle(json: GithubJSON, repo: GithubLocation, number: number) {
  const [owner, name] = repo.nameWithOwner.split('/')
  return decode(
    mutableStruct({
      data: mutableStruct({ repository: mutableStruct({ pullRequest: lifecycle }) }),
    }),
    await githubGraphql(
      json,
      repo,
      `query($owner:String!,$name:String!,$number:Int!){repository(owner:$owner,name:$name){pullRequest(number:$number){id headRefOid state isDraft mergeStateStatus isInMergeQueue viewerCanUpdate viewerCanEnableAutoMerge viewerCanDisableAutoMerge autoMergeRequest{mergeMethod}}}}`,
      ['-f', `owner=${owner}`, '-f', `name=${name}`, '-F', `number=${number}`],
    ),
  ).data.repository.pullRequest
}

export async function changeGithubLifecycle(
  json: GithubJSON,
  repo: GithubLocation,
  input: Extract<PullAction, { action: 'draft' | 'auto-merge' }>,
) {
  const current = await githubLifecycle(json, repo, input.number)
  if (current.headRefOid !== input.headSha)
    throw new HttpError(409, 'This PR changed. Refresh before continuing.')
  if (current.state !== 'OPEN') throw new HttpError(409, 'This pull request is no longer open.')
  if (current.isInMergeQueue)
    throw new HttpError(409, 'This PR is in the merge queue. Manage its queue entry on GitHub.')
  let mutation: string
  let fields: string[]
  let selection: string
  if (input.action === 'draft') {
    if (!current.viewerCanUpdate)
      throw new HttpError(403, 'Your GitHub account cannot change this PR’s draft status.')
    if (current.isDraft === input.draft) return
    mutation = input.draft ? 'convertPullRequestToDraft' : 'markPullRequestReadyForReview'
    fields = ['-f', `id=${current.id}`]
    selection = 'isDraft'
  } else {
    const enabled = !!current.autoMergeRequest
    if (enabled === input.enabled) {
      if (input.enabled && current.autoMergeRequest?.mergeMethod !== input.method.toUpperCase())
        throw new HttpError(
          409,
          'Auto-merge was enabled with a different merge method. Refresh before continuing.',
        )
      return
    }
    if (input.enabled ? !current.viewerCanEnableAutoMerge : !current.viewerCanDisableAutoMerge)
      throw new HttpError(403, 'Your GitHub account cannot change auto-merge for this PR.')
    if (input.enabled && current.isDraft)
      throw new HttpError(409, 'Mark this PR ready for review before enabling auto-merge.')
    mutation = input.enabled ? 'enablePullRequestAutoMerge' : 'disablePullRequestAutoMerge'
    fields = [
      '-f',
      `id=${current.id}`,
      ...(input.enabled
        ? ['-f', `method=${input.method.toUpperCase()}`, '-f', `head=${input.headSha}`]
        : []),
    ]
    selection = 'autoMergeRequest{mergeMethod}'
  }
  const enabling = input.action === 'auto-merge' && input.enabled
  const response = decode(
    mutableStruct({
      data: Schema.Record(
        Schema.String,
        mutableStruct({
          pullRequest: mutableStruct({
            id: Schema.String,
            isDraft: Schema.optional(Schema.Boolean),
            autoMergeRequest: Schema.optional(
              Schema.NullOr(mutableStruct({ mergeMethod: Schema.String })),
            ),
          }),
        }),
      ),
    }),
    await githubGraphql(
      json,
      repo,
      `mutation($id:ID!${enabling ? ',$method:PullRequestMergeMethod!,$head:GitObjectID!' : ''}){${mutation}(input:{pullRequestId:$id${enabling ? ',mergeMethod:$method,expectedHeadOid:$head' : ''}}){pullRequest{id ${selection}}}}`,
      fields,
    ),
  ).data[mutation]?.pullRequest
  if (
    response?.id !== current.id ||
    (input.action === 'draft'
      ? response.isDraft !== input.draft
      : response.autoMergeRequest === undefined ||
        !!response.autoMergeRequest !== input.enabled ||
        (input.enabled && response.autoMergeRequest?.mergeMethod !== input.method.toUpperCase()))
  )
    throw new Error('GitHub did not confirm this PR update. Refresh before retrying.')
}
