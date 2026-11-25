import { Schema } from 'effect'
import { maxValue, minValue, mutableStruct } from '../shared/schema.js'

export const pipelineWaitSchema = mutableStruct({
  url: maxValue(Schema.String, 512),
  /** A preceding typed task may supply an exact attempt URL as a JSON string. */
  resultStepId: Schema.optional(maxValue(minValue(Schema.String, 1), 200)),
  timeoutMinutes: Schema.Number.pipe(
    Schema.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 1440 })),
  ),
})
export const defaultPipelineWait: typeof pipelineWaitSchema.Type = { url: '', timeoutMinutes: 60 }

export function githubPipelineAttempt(url: string) {
  const match =
    /^https:\/\/([a-z0-9][a-z0-9-]*(?:\.[a-z0-9][a-z0-9-]*)+)\/([\w.-]+\/[\w.-]+)\/actions\/runs\/([1-9][0-9]*)\/attempts\/([1-9][0-9]*)\/?$/i.exec(
      url.trim(),
    )
  const attempt = Number(match?.[4])
  if (
    url.trim().length > 512 ||
    !match ||
    !Number.isSafeInteger(attempt) ||
    !Number.isSafeInteger(Number(match[3]))
  )
    throw new Error('Enter a GitHub Actions URL that includes the run and attempt.')
  return { host: match[1].toLowerCase(), repository: match[2], runId: match[3], attempt }
}

export function pipelineWaitUrl(config: typeof pipelineWaitSchema.Type, result?: Schema.Json) {
  const value = config.resultStepId ? result : config.url
  if (typeof value !== 'string')
    throw new Error(
      'The preceding task must return the GitHub Actions attempt URL as a JSON string.',
    )
  githubPipelineAttempt(value)
  return value.trim()
}
