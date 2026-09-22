import { z } from 'zod'
import type { PullSummary } from '@dovo/protocol'
import type { GitService } from './git.js'
import { errorMessage } from '../errors.js'
const status = z.object({
  viewerDidAuthor: z.boolean().optional(),
  reviewRequests: z
    .object({
      nodes: z.array(
        z
          .object({ requestedReviewer: z.object({ login: z.string().optional() }).nullable() })
          .nullable(),
      ),
      pageInfo: z.object({ hasNextPage: z.boolean() }),
    })
    .optional(),
  reviewDecision: z.string().nullable(),
  statusCheckRollup: z.object({ state: z.string() }).nullable(),
})
type SummaryStatus = Pick<
  PullSummary,
  'checksState' | 'reviewDecision' | 'statusError' | 'viewerIsAuthor' | 'viewerReviewRequested'
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
        `pr${n}:pullRequest(number:${n}){viewerDidAuthor reviewRequests(first:100){nodes{requestedReviewer{... on User{login}}} pageInfo{hasNextPage}} reviewDecision statusCheckRollup{state}}`,
    )
    .join(' ')
  const query = `query($owner:String!,$name:String!){viewer{login} repository(owner:$owner,name:$name){${fields}}}`
  try {
    const response = z
      .object({
        data: z.object({
          viewer: z.object({ login: z.string() }).optional(),
          repository: z.record(z.string(), status.nullable()),
        }),
      })
      .parse(
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
                ? { viewerIsAuthor: value.viewerDidAuthor }
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
              checksState: value.statusCheckRollup?.state ?? null,
              reviewDecision: value.reviewDecision,
            }
          : { statusError: 'PR status unavailable' },
      )
    }
  } catch (error) {
    for (const number of numbers) result.set(number, { statusError: errorMessage(error) })
  }
  return result
}
