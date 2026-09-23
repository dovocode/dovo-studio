import { mutableStruct, mutableArray } from '@dovo/protocol'
import { urlSchema, decode } from '@dovo/protocol'
import { Schema } from 'effect'
import type { PullDetail } from '@dovo/protocol'
import { githubApi, type GithubJSON, type GithubLocation } from './github-api.js'
import { errorMessage } from '../errors.js'
const check = mutableStruct({
  id: Schema.Number.pipe(Schema.finite())
    .pipe(Schema.int(), Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER))
    .pipe(Schema.positive()),
  name: Schema.String,
  status: Schema.String,
  conclusion: Schema.NullOr(Schema.String),
  html_url: Schema.optional(Schema.NullOr(urlSchema())),
  details_url: Schema.optional(Schema.NullOr(urlSchema())),
  started_at: Schema.optional(Schema.NullOr(Schema.String)),
  completed_at: Schema.optional(Schema.NullOr(Schema.String)),
  output: Schema.optional(
    mutableStruct({
      summary: Schema.NullOr(Schema.String),
      text: Schema.optional(Schema.NullOr(Schema.String)),
      annotations_count: Schema.Number.pipe(Schema.finite())
        .pipe(Schema.int(), Schema.between(Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER))
        .pipe(Schema.nonNegative()),
    }),
  ),
})
const annotation = mutableStruct({
  path: Schema.String,
  start_line: Schema.Number.pipe(Schema.finite()),
  end_line: Schema.Number.pipe(Schema.finite()),
  annotation_level: Schema.String,
  message: Schema.String,
  title: Schema.optional(Schema.NullOr(Schema.String)),
})
export async function githubChecks(json: GithubJSON, repo: GithubLocation, headSha: string) {
  const pages = decode(
    mutableArray(
      mutableStruct({
        check_runs: mutableArray(check),
      }),
    ),
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
              ? {
                  url: run.details_url || run.html_url || undefined,
                }
              : {}),
            ...(run.output?.summary
              ? {
                  summary: run.output.summary,
                }
              : {}),
            ...(run.output?.text
              ? {
                  details: run.output.text,
                }
              : {}),
            ...(run.started_at
              ? {
                  startedAt: run.started_at,
                }
              : {}),
            ...(run.completed_at
              ? {
                  completedAt: run.completed_at,
                }
              : {}),
          }
          if (run.output?.annotations_count) {
            try {
              const annotations = decode(
                mutableArray(mutableArray(annotation)),
                await githubApi(
                  json,
                  repo,
                  `check-runs/${run.id}/annotations?per_page=100`,
                  'GET',
                  ['--paginate', '--slurp'],
                ),
              ).flat()
              value.annotations = annotations.map((item) => ({
                path: item.path,
                startLine: item.start_line,
                endLine: item.end_line,
                level: item.annotation_level,
                message: item.message,
                ...(item.title
                  ? {
                      title: item.title,
                    }
                  : {}),
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
  return {
    checks,
    warnings,
  }
}
