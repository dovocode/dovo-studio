import type { z } from 'zod'
import type {
  ForgeWorkOptions,
  ForgeIssueCreate,
  ForgeIssueAction,
  ForgePipelineAction,
  ForgeWorkResult,
  forgeIssuePageSchema,
  forgeIssueDetailSchema,
  forgePipelinePageSchema,
  forgePipelineDetailSchema,
  forgeDefinitionsSchema,
} from '@dovo/protocol'
import type { ForgeHttpOptions } from './forge-http.js'
export type WorkHttp = { json: (path: string, options?: ForgeHttpOptions) => Promise<unknown> }
export interface ForgeWorkProvider {
  options(type?: string, area?: string): Promise<ForgeWorkOptions>
  issues(
    state: string,
    cursor?: string,
    query?: string,
  ): Promise<z.infer<typeof forgeIssuePageSchema>>
  issue(id: string, cursor?: string): Promise<z.infer<typeof forgeIssueDetailSchema>>
  createIssue(input: ForgeIssueCreate): Promise<ForgeWorkResult>
  actOnIssue(input: ForgeIssueAction): Promise<ForgeWorkResult>
  definitions(cursor?: string): Promise<z.infer<typeof forgeDefinitionsSchema>>
  pipelines(cursor?: string): Promise<z.infer<typeof forgePipelinePageSchema>>
  pipeline(id: string, cursor?: string): Promise<z.infer<typeof forgePipelineDetailSchema>>
  actOnPipeline(input: ForgePipelineAction): Promise<ForgeWorkResult>
}
