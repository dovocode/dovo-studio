import { z } from 'zod'

/** Durable routing metadata only. Credentials are resolved and verified on each read. */
export const watchSourceSchema = z.object({
  url: z.string(),
  repository: z.string(),
  accountRepositoryId: z.string().optional(),
  connectionId: z.string().optional(),
  readerIdentity: z.string(),
  destination: z.string(),
})
export type WatchSource = z.infer<typeof watchSourceSchema>

/** Known URL shapes only; configured host/account checks happen in forge URL routing. */
export function pipelineUrlTarget(input: string) {
  try {
    const url = new URL(input)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null
    const github = url.pathname.match(
      /^(\/[^/]+\/[^/]+)\/actions\/runs\/([1-9]\d*)(?:\/job\/[1-9]\d*)?\/?$/,
    )
    const gitlab = url.pathname.match(/^(\/.+?)\/-\/pipelines\/([1-9]\d*)\/?$/)
    const match = github ?? gitlab
    if (!match) return null
    return {
      id: match[2],
      pullUrl: `${url.origin}${match[1]}/${github ? 'pull' : '-/merge_requests'}/1`,
    }
  } catch {
    return null
  }
}
