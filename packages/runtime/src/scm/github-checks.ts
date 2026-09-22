import { z } from 'zod'
import type { PullDetail } from '@dovo/protocol'
import { githubApi, type GithubJSON, type GithubLocation } from './github-api.js'
import { errorMessage } from '../errors.js'

const check = z.object({
  id: z.number().int().positive(),
  name: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
  html_url: z.url().nullish(),
  details_url: z.url().nullish(),
  started_at: z.string().nullish(),
  completed_at: z.string().nullish(),
  output: z
    .object({
      summary: z.string().nullable(),
      text: z.string().nullish(),
      annotations_count: z.number().int().nonnegative(),
    })
    .optional(),
})
const annotation = z.object({
  path: z.string(),
  start_line: z.number(),
  end_line: z.number(),
  annotation_level: z.string(),
  message: z.string(),
  title: z.string().nullish(),
})

export async function githubChecks(json: GithubJSON, repo: GithubLocation, headSha: string) {
  const pages = z
    .array(z.object({ check_runs: z.array(check) }))
    .parse(
      await json([
        'api',
        '--hostname',
        repo.host,
        `${repo.path}/commits/${headSha}/check-runs?per_page=100`,
        '--paginate',
        '--slurp',
      ]),
    )
  const checks: PullDetail['checks'] = []
  const warnings: string[] = []
  const runs = pages.flatMap((page) => page.check_runs)
  // Keep upstream concurrency bounded; an unavailable annotation page must not
  // erase the status or summary already returned for the check.
  for (let offset = 0; offset < runs.length; offset += 3) {
    checks.push(
      ...(await Promise.all(
        runs.slice(offset, offset + 3).map(async (run) => {
          const value: PullDetail['checks'][number] = {
            id: String(run.id),
            name: run.name,
            status: run.conclusion || run.status,
            ...(run.details_url || run.html_url
              ? { url: run.details_url || run.html_url || undefined }
              : {}),
            ...(run.output?.summary ? { summary: run.output.summary } : {}),
            ...(run.output?.text ? { details: run.output.text } : {}),
            ...(run.started_at ? { startedAt: run.started_at } : {}),
            ...(run.completed_at ? { completedAt: run.completed_at } : {}),
          }
          if (run.output?.annotations_count) {
            try {
              const annotations = z
                .array(z.array(annotation))
                .parse(
                  await githubApi(
                    json,
                    repo,
                    `check-runs/${run.id}/annotations?per_page=100`,
                    'GET',
                    ['--paginate', '--slurp'],
                  ),
                )
                .flat()
              value.annotations = annotations.map((item) => ({
                path: item.path,
                startLine: item.start_line,
                endLine: item.end_line,
                level: item.annotation_level,
                message: item.message,
                ...(item.title ? { title: item.title } : {}),
              }))
              if (annotations.length < run.output.annotations_count)
                warnings.push(`${run.name}: GitHub returned only part of this check’s annotations.`)
            } catch (error) {
              warnings.push(`${run.name} annotations: ${errorMessage(error)}`)
            }
          }
          return value
        }),
      )),
    )
  }
  return { checks, warnings }
}
