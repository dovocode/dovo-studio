import { mutableStruct, mutableArray } from '@dovo/protocol'
import { decode } from '@dovo/protocol'
import { Schema } from 'effect'
import type { PullSummary } from '@dovo/protocol'
import type { GitService } from '../git/git.js'
import { errorMessage } from '../../errors.js'
const status = mutableStruct({
  additions: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
  deletions: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
  totalCommentsCount: Schema.optional(Schema.Number.pipe(Schema.int(), Schema.nonNegative())),
  viewerDidAuthor: Schema.optional(Schema.Boolean),
  assignees: Schema.optional(
    mutableStruct({
      nodes: mutableArray(mutableStruct({ login: Schema.String })),
      pageInfo: mutableStruct({ hasNextPage: Schema.Boolean }),
    }),
  ),
  participants: Schema.optional(
    mutableStruct({
      nodes: mutableArray(mutableStruct({ login: Schema.String })),
      pageInfo: mutableStruct({ hasNextPage: Schema.Boolean }),
    }),
  ),
  reviewRequests: Schema.optional(
    mutableStruct({
      nodes: mutableArray(
        Schema.NullOr(
          mutableStruct({
            requestedReviewer: Schema.NullOr(
              mutableStruct({
                login: Schema.optional(Schema.String),
              }),
            ),
          }),
        ),
      ),
      pageInfo: mutableStruct({
        hasNextPage: Schema.Boolean,
      }),
    }),
  ),
  reviewDecision: Schema.NullOr(Schema.String),
  statusCheckRollup: Schema.NullOr(
    mutableStruct({
      state: Schema.String,
    }),
  ),
})
type SummaryStatus = Pick<
  PullSummary,
  | 'checksState'
  | 'reviewDecision'
  | 'statusError'
  | 'viewerIsAuthor'
  | 'viewerReviewRequested'
  | 'additions'
  | 'deletions'
  | 'commentCount'
  | 'viewerIsAssigned'
  | 'viewerIsInvolved'
>
export async function pullStatuses(
  git: GitService,
  cwd: string,
  host: string,
  repository: string,
  numbers: number[],
  run: (args: string[]) => Promise<string> = (args) => git.github(cwd, args),
) {
  const result = new Map<number, SummaryStatus>()
  if (!numbers.length) return result
  const [owner, name] = repository.split('/')
  const fields = numbers
    .map(
      (n) =>
        `pr${n}:pullRequest(number:${n}){additions deletions totalCommentsCount viewerDidAuthor assignees(first:100){nodes{login} pageInfo{hasNextPage}} participants(first:100){nodes{login} pageInfo{hasNextPage}} reviewRequests(first:100){nodes{requestedReviewer{... on User{login}}} pageInfo{hasNextPage}} reviewDecision statusCheckRollup{state}}`,
    )
    .join(' ')
  const query = `query($owner:String!,$name:String!){viewer{login} repository(owner:$owner,name:$name){${fields}}}`
  try {
    const response = decode(
      mutableStruct({
        data: mutableStruct({
          viewer: Schema.optional(
            mutableStruct({
              login: Schema.String,
            }),
          ),
          repository: Schema.mutable(
            Schema.Record({
              key: Schema.String,
              value: Schema.NullOr(status),
            }),
          ),
        }),
      }),
      JSON.parse(
        await run([
          'api',
          '--hostname',
          host,
          'graphql',
          '-f',
          `query=${query}`,
          '-f',
          `owner=${owner}`,
          '-f',
          `name=${name}`,
        ]),
      ),
    )
    for (const number of numbers) {
      const value = response.data.repository[`pr${number}`]
      result.set(
        number,
        value
          ? {
              ...(value.viewerDidAuthor !== undefined
                ? {
                    viewerIsAuthor: value.viewerDidAuthor,
                  }
                : {}),
              ...(value.reviewRequests && response.data.viewer
                ? {
                    viewerReviewRequested: value.reviewRequests.nodes.some(
                      (request) =>
                        request?.requestedReviewer?.login === response.data.viewer?.login,
                    )
                      ? true
                      : value.reviewRequests.pageInfo.hasNextPage ||
                          value.reviewRequests.nodes.some(
                            (request) => !request?.requestedReviewer?.login,
                          )
                        ? undefined
                        : false,
                  }
                : {}),
              ...(value.additions !== undefined ? { additions: value.additions } : {}),
              ...(value.deletions !== undefined ? { deletions: value.deletions } : {}),
              ...(value.totalCommentsCount !== undefined
                ? { commentCount: value.totalCommentsCount }
                : {}),
              viewerIsAssigned:
                value.assignees && response.data.viewer
                  ? value.assignees.nodes.some((user) => user.login === response.data.viewer?.login)
                    ? true
                    : value.assignees.pageInfo.hasNextPage
                      ? undefined
                      : false
                  : undefined,
              viewerIsInvolved:
                value.participants && response.data.viewer
                  ? value.participants.nodes.some(
                      (user) => user.login === response.data.viewer?.login,
                    ) ||
                    value.viewerDidAuthor === true ||
                    value.assignees?.nodes.some(
                      (user) => user.login === response.data.viewer?.login,
                    ) === true ||
                    value.reviewRequests?.nodes.some(
                      (request) =>
                        request?.requestedReviewer?.login === response.data.viewer?.login,
                    ) === true
                    ? true
                    : value.participants.pageInfo.hasNextPage ||
                        value.assignees?.pageInfo.hasNextPage ||
                        value.reviewRequests?.pageInfo.hasNextPage
                      ? undefined
                      : false
                  : undefined,
              checksState: value.statusCheckRollup?.state ?? null,
              reviewDecision: value.reviewDecision,
            }
          : {
              statusError: 'PR status unavailable',
            },
      )
    }
  } catch (error) {
    for (const number of numbers)
      result.set(number, {
        statusError: errorMessage(error),
      })
  }
  return result
}
