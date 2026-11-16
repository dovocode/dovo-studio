import type { SandboxSession } from '../../sandbox/launcher.js'
import type { Agent, ProviderStatus, AgentDiscovery, ModelCatalog } from '@dovo/protocol'
import type { QuestionPrompt, QuestionAnswers, QuestionOutcomes } from '@dovo/protocol'
export type AgentInput = {
  id: string
  prompt: string
  attachments?: AgentRun['attachments']
}
export type AgentSteer = (input: AgentInput) => Promise<void>
export type NativeAgentSession = {
  /** Stop one native child, or all children owned by this session, and await cleanup. */
  stop: (id?: string) => Promise<void>
  readThread?: (id: string) => Promise<import('@dovo/protocol').NativeThreadEntry[]>
}
export type ApprovalDecision = 'approve' | 'session' | 'always' | 'deny'
export interface AcpLaunch {
  /** Built-in headless authentication; custom ACP installs keep their own flow. */
  authentication?: 'grok'
  command: string
  args: string[]
  env: Record<string, string>
  /** Start this agent inside a thread's container sandbox. */
  sandbox?: SandboxSession
}
export interface AgentRun {
  /** Register only a dedicated, detached launcher owned by this run. Rebind on warm reuse. */
  onOwnedProcess?: (child: import('node:child_process').ChildProcess) => void
  /** Stable task identity for a warm provider transport. Utility runs omit it. */
  taskId?: string
  /** Do not retain this one-off conversation in the provider's session history. */
  ephemeral?: boolean
  /** Non-blocking message forms: answers arrive as a new user message, possibly after this turn. */
  onQuestions?: (prompt: QuestionPrompt) => void
  /** Available only while the harness accepts input into its active turn. */
  onSteer?: (steer: AgentSteer | undefined) => void
  agent: Agent
  acpLaunch?: AcpLaunch
  /** Prepare the thread's container sandbox for the resolved harness. The registry calls it
   * once per run and passes the result as `sandbox`. */
  prepareSandbox?: (agent: Agent, acpLaunch: AcpLaunch | undefined) => Promise<SandboxSession>
  /** Every harness process for this run starts inside this container through `spawnHarness`. */
  sandbox?: SandboxSession
  cwd: string
  linkedDirectories?: Array<{ id: string; path: string; access: 'read-only' | 'edit' }>
  attachments?: Array<import('@dovo/protocol').Attachment & { path: string; data: string }>
  prompt: string
  /** Request the provider's native compaction, without treating the command as a model prompt. */
  compact?: boolean
  /** Execute a user-authored native goal command, without the conversation wrapper. */
  goal?: import('@dovo/protocol').GoalCommand
  sessionId?: string
  signal: AbortSignal
  /** Request a utility turn without tools. Image input remains available where supported. */
  tools?: 'none'
  /** Ignore provider settings from untrusted PR evidence. */
  isolateSettings?: boolean
  /** Constrain the final utility response where the provider supports JSON Schema. */
  outputSchema?: Record<string, unknown>
  /** Evidence that the provider accepted this prompt, distinct from session allocation. */
  onPromptAccepted?: () => void
  onSession: (id: string) => void
  onText: (text: string) => void
  /** Replace the last `previousLength` characters emitted by this execution with canonical text. */
  onTextReplace?: (text: string, previousLength: number) => void
  onTextBoundary?: () => void
  onActivity: (text: string) => void
  onEvent?: (name: string, payload: unknown) => void
  /** Session-owned native-agent metadata; may arrive after the parent provider turn ends. */
  onSubagentEvent?: (name: string, payload: unknown, sessionId?: string) => void
  onNativeSession?: (session: NativeAgentSession, sessionId: string) => void
  onNativeTurnEnd?: () => void
  /** Session-owned interactions for native agents that outlive the parent turn. */
  nativeAgentInteractions?: {
    /** True while the thread still accepts native work under this run's session and policy.
     * Providers that let native work run without a turn must check it before every tool use.
     * Claude refuses such work when it is absent. */
    active?: () => boolean
    approve: (
      title: string,
      detail: string,
      signal: AbortSignal,
      kind?: 'web' | 'command',
      options?: {
        session?: boolean
        always?: boolean
      },
    ) => Promise<ApprovalDecision>
    ask: AgentRun['ask']
  }
  approve: (
    title: string,
    detail: string,
    kind?: 'web' | 'command',
    options?: {
      session?: boolean
      always?: boolean
    },
  ) => Promise<ApprovalDecision>
  ask: (
    prompt: QuestionPrompt,
    signal?: AbortSignal,
    validate?: (answers: QuestionAnswers) => void,
    onUnanswered?: (outcomes: QuestionOutcomes) => void,
  ) => Promise<QuestionAnswers | null>
}
export interface AgentAdapter {
  /** Read a provider-native child transcript without starting a model turn. */
  readNativeThread?: (
    agent: Agent,
    id: string,
    sessionId: string | undefined,
    cwd?: string,
    /** A sandboxed thread's container. Only Codex reads through it; see `sandboxNativeReads`. */
    sandbox?: SandboxSession,
  ) => Promise<import('@dovo/protocol').NativeThreadEntry[]>
  models?: (agent: AgentDiscovery, launch?: AcpLaunch) => Promise<ModelCatalog>
  run: (run: AgentRun) => Promise<void>
  probe: (agent: Agent, launch?: AcpLaunch) => Promise<ProviderStatus>
  dispose?: () => Promise<void>
  /** Release this task's idle transport without interrupting provider-native children. */
  releaseTask?: (taskId: string) => Promise<void>
}
