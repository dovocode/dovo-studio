import { Schema } from 'effect'
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
export type WorkHttp = {
  json: (path: string, options?: ForgeHttpOptions) => Promise<unknown>
}
export interface ForgeWorkProvider {
  options(type?: string, area?: string): Promise<ForgeWorkOptions>
  issues(
    state: string,
    cursor?: string,
    query?: string,
  ): Promise<Schema.Schema.Type<typeof forgeIssuePageSchema>>
  issue(id: string, cursor?: string): Promise<Schema.Schema.Type<typeof forgeIssueDetailSchema>>
  createIssue(input: ForgeIssueCreate): Promise<ForgeWorkResult>
  actOnIssue(input: ForgeIssueAction): Promise<ForgeWorkResult>
  definitions(cursor?: string): Promise<Schema.Schema.Type<typeof forgeDefinitionsSchema>>
  pipelines(cursor?: string): Promise<Schema.Schema.Type<typeof forgePipelinePageSchema>>
  pipeline(
    id: string,
    cursor?: string,
  ): Promise<Schema.Schema.Type<typeof forgePipelineDetailSchema>>
  actOnPipeline(input: ForgePipelineAction): Promise<ForgeWorkResult>
}
