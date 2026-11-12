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
  viewerCanUpdateBranch: Schema.optional(Schema.Boolean),
  baseRef: Schema.optional(
    Schema.NullOr(
      mutableStruct({
        compare: Schema.NullOr(
          mutableStruct({ behindBy: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)) }),
        ),
      }),
    ),
  ),
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
      `query($owner:String!,$name:String!,$number:Int!,$head:String!){repository(owner:$owner,name:$name){pullRequest(number:$number){id headRefOid state isDraft mergeStateStatus isInMergeQueue viewerCanUpdate viewerCanUpdateBranch baseRef{compare(headRef:$head){behindBy}} viewerCanEnableAutoMerge viewerCanDisableAutoMerge autoMergeRequest{mergeMethod}}}}`,
      [
        '-f',
        `owner=${owner}`,
        '-f',
        `name=${name}`,
        '-F',
        `number=${number}`,
        '-f',
        `head=refs/pull/${number}/head`,
      ],
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

/** GitHub's Update branch button uses a merge, so published commits stay intact. */
export async function updateGithubBranch(
  json: GithubJSON,
  repo: GithubLocation,
  input: Extract<PullAction, { action: 'update-branch' }>,
) {
  const current = await githubLifecycle(json, repo, input.number)
  if (current.headRefOid !== input.headSha)
    throw new HttpError(409, 'This PR changed. Refresh before continuing.')
  if (current.state !== 'OPEN' || current.isInMergeQueue)
    throw new HttpError(409, 'This PR is closed or in the merge queue.')
  const behind = current.baseRef?.compare?.behindBy
  if (behind === 0) return
  if (behind === undefined)
    throw new HttpError(409, 'GitHub could not compare this branch. Refresh before continuing.')
  if (!current.viewerCanUpdateBranch)
    throw new HttpError(
      403,
      'GitHub cannot update this branch. Check branch permissions or conflicts.',
    )
  const result = decode(
    mutableStruct({
      data: mutableStruct({
        updatePullRequestBranch: Schema.NullOr(
          mutableStruct({
            pullRequest: Schema.NullOr(
              mutableStruct({ id: Schema.String, headRefOid: Schema.String }),
            ),
          }),
        ),
      }),
    }),
    await githubGraphql(
      json,
      repo,
      'mutation($id:ID!,$head:GitObjectID!){updatePullRequestBranch(input:{pullRequestId:$id,expectedHeadOid:$head,updateMethod:MERGE}){pullRequest{id headRefOid}}}',
      ['-f', `id=${current.id}`, '-f', `head=${input.headSha}`],
    ),
  ).data.updatePullRequestBranch?.pullRequest
  if (result?.id !== current.id || !result.headRefOid || result.headRefOid === input.headSha)
    throw new Error('GitHub did not confirm the branch update. Refresh before retrying.')
}
