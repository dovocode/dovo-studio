import type { Agent, ProviderStatus, AgentDiscovery, ModelCatalog } from '@dovo/protocol'
import type { QuestionPrompt, QuestionAnswers } from '@dovo/protocol'
export type AgentInput = {
  id: string
  prompt: string
  attachments?: AgentRun['attachments']
}
export type AgentSteer = (input: AgentInput) => Promise<void>
export interface AcpLaunch {
  command: string
  args: string[]
  env: Record<string, string>
}
export interface AgentRun {
  /** Non-blocking message forms: answers arrive as a new user message, possibly after this turn. */
  onQuestions?: (prompt: QuestionPrompt) => void
  /** Available only while the harness accepts input into its active turn. */
  onSteer?: (steer: AgentSteer | undefined) => void
  agent: Agent
  acpLaunch?: AcpLaunch
  cwd: string
  attachments?: Array<import('@dovo/protocol').Attachment & { path: string; data: string }>
  prompt: string
  sessionId?: string
  signal: AbortSignal
  /** Request a text-only utility turn. Adapters disable tools where supported. */
  tools?: 'none'
  /** Evidence that the provider accepted this prompt, distinct from session allocation. */
  onPromptAccepted?: () => void
  onSession: (id: string) => void
  onText: (text: string) => void
  onActivity: (text: string) => void
  onEvent?: (name: string, payload: unknown) => void
  approve: (title: string, detail: string) => Promise<boolean>
  ask: (
    prompt: QuestionPrompt,
    signal?: AbortSignal,
    validate?: (answers: QuestionAnswers) => void,
  ) => Promise<QuestionAnswers | null>
}
export interface AgentAdapter {
  models?: (agent: AgentDiscovery, launch?: AcpLaunch) => Promise<ModelCatalog>
  run: (run: AgentRun) => Promise<void>
  probe: (agent: Agent, launch?: AcpLaunch) => Promise<ProviderStatus>
}
