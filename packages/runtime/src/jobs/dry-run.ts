import {
  automationDryRunDefaults,
  automationIssues,
  botPaused,
  githubEventChoices,
  projectDisplayName,
  resolveTaskAgent,
  type AutomationData,
  type AutomationDryRun,
  type AutomationDryRunRequest,
  type AutomationNode,
  type TaskSummary,
  type Workspace,
} from '@dovo/protocol'
import { ROUTINE_SOURCE_TEXT_LIMIT } from './source-monitor.js'
import { taskStepObjective, triggerContext } from './step-input.js'

type DryRunStepKind = AutomationData['kind'] | 'source'
type DryRunStep = AutomationDryRun['steps'][number]

/**
 * How a dry run treats each step kind. `pure` steps run for real because they only read the
 * sample input and saved settings. `external` steps are simulated because a real run would write
 * outside the run: start threads and agents, wait for people, or read external sources.
 * A new step kind fails typechecking here until someone classifies it.
 */
export const dryRunStepEffects = {
  /** Resolves the sample input and applies trigger filters. It never fires a trigger. */
  trigger: 'pure',
  /** Creates a thread or Bot worker. Its agent can change files, call tools and open PRs. */
  task: 'external',
  /** Waits for a person to approve the run. */
  review: 'external',
  /** Reads an HTTP URL or MCP resource before the steps. */
  source: 'external',
} as const satisfies Record<DryRunStepKind, 'pure' | 'external'>

/** Unknown step kinds, for example from a newer client, are simulated. */
export function dryRunStepEffect(kind: string): 'pure' | 'external' {
  for (const [known, effect] of Object.entries(dryRunStepEffects)) if (known === kind) return effect
  return 'external'
}

export type DryRunContext = {
  workspace: Pick<Workspace, 'agents' | 'repositories'> & { tasks: readonly TaskSummary[] }
  now?: number
  /** The managed-policy message when webhook tasks are blocked. */
  webhookBlocked?: string
}

/**
 * Evaluate a flow with sample data. This is a pure function of the request and a workspace
 * snapshot: it saves nothing, starts nothing and sends nothing.
 */
export function dryRunAutomation(
  request: AutomationDryRunRequest,
  context: DryRunContext,
): AutomationDryRun {
  const { flow } = request
  const now = context.now ?? Date.now()
  const trigger = flow.nodes.find((node) => node.data.kind === 'trigger')
  const input = { ...automationDryRunDefaults(flow, now), ...request.input }
  const result: AutomationDryRun = {
    outcome: 'completed',
    trigger: trigger?.data.trigger ?? 'manual',
    generated: !request.input,
    input,
    issues: automationIssues(flow, context.workspace),
    warnings: [],
    steps: [],
    unexercised: [],
  }
  const unreached = (node: AutomationNode): DryRunStep => ({
    nodeId: node.id,
    label: node.data.label,
    kind: node.data.kind,
    status: 'not-reached',
    inputs: [],
  })
  if (!trigger || result.issues.length) {
    result.outcome = 'invalid'
    result.steps = flow.nodes.map(unreached)
    return result
  }
  const kind = trigger.data.trigger
  const automatic = kind !== 'manual'
  // Real runs pass trigger data only for deliveries. Schedules pass their due time to Bot workers.
  const triggerPayload = kind === 'webhook' || kind === 'github' ? input.payload : undefined
  const monitor = flow.monitor
  const source =
    monitor && input.sourceText
      ? {
          sourceUrl: monitor.mcp
            ? `mcp:${JSON.stringify([monitor.mcp.server, monitor.mcp.uri])}`
            : monitor.url,
          sourceText: input.sourceText.slice(0, ROUTINE_SOURCE_TEXT_LIMIT),
        }
      : {}
  if (automatic && !flow.enabled)
    result.warnings.push(
      'Automatic triggers are paused. This trigger starts no runs until you enable it.',
    )
  if (kind === 'webhook' && context.webhookBlocked) result.warnings.push(context.webhookBlocked)

  const done = new Set<string>()
  while (result.outcome === 'completed') {
    // Same order as a real run: the first saved node whose predecessors have finished.
    const node = flow.nodes.find(
      (item) =>
        !done.has(item.id) &&
        flow.edges.filter((edge) => edge.target === item.id).every((edge) => done.has(edge.source)),
    )
    if (!node) break
    done.add(node.id)
    const nodeKind: string = node.data.kind
    const effect = dryRunStepEffect(nodeKind)
    if (nodeKind === 'trigger' && effect === 'pure') {
      result.steps.push(triggerStep(node, input, triggerPayload, result))
      if (monitor && result.outcome === 'completed') result.steps.push(sourceStep(node, monitor))
      continue
    }
    const stop = request.stopAt === node.id
    if (stop) result.outcome = 'stopped'
    if (nodeKind === 'task') result.steps.push(taskStep(node, stop))
    else if (nodeKind === 'review')
      result.steps.push({
        nodeId: node.id,
        label: node.data.label,
        kind: nodeKind,
        status: 'simulated',
        inputs: [{ name: 'Waits for', value: 'A person to approve or reject the run' }],
        output: stop ? 'Simulated rejection. The run stops here.' : 'Simulated approval.',
      })
    else
      result.steps.push({
        nodeId: node.id,
        label: node.data.label,
        kind: nodeKind,
        status: 'simulated',
        inputs: [],
        output: stop ? 'Simulated failure. The run stops here.' : 'Simulated.',
        note: 'Dovo does not know this step kind, so the dry run did not run it.',
      })
    if (nodeKind === 'review')
      result.unexercised.push(
        stop ? `Approval at "${node.data.label}".` : `Rejection at "${node.data.label}".`,
      )
    else if (!stop) result.unexercised.push(`Failure of "${node.data.label}".`)
  }
  for (const node of flow.nodes)
    if (!done.has(node.id)) {
      result.steps.push(unreached(node))
      result.unexercised.push(`"${node.data.label}" was not reached.`)
    }
  if (flow.policy?.minutes || flow.policy?.tokens || flow.policy?.costUsd)
    result.unexercised.push('Routine limits for time, tokens and cost. They need real usage.')
  if (flow.policy?.quietHours)
    result.unexercised.push(
      'Quiet hours. During them, a real run delays successful Bot reports and sends no push notification for successful work.',
    )
  if (monitor && result.steps.some((step) => step.kind === 'task' && step.status === 'simulated'))
    result.unexercised.push(
      'The previous successful source. After the first successful run, task instructions also include it.',
    )
  return result

  function sourceStep(node: AutomationNode, monitor: NonNullable<typeof flow.monitor>): DryRunStep {
    const step: DryRunStep = {
      nodeId: `${node.id}:source`,
      label: 'Monitored source',
      kind: 'source',
      status: 'simulated',
      inputs: [
        {
          name: 'Source',
          value: monitor.mcp ? `MCP ${monitor.mcp.server} · ${monitor.mcp.uri}` : monitor.url,
        },
        ...(monitor.jsonPointer ? [{ name: 'JSON pointer', value: monitor.jsonPointer }] : []),
      ],
      output: input.sourceText
        ? `Simulated. Dovo did not read the source. Sample content:\n${input.sourceText}`
        : 'Simulated. Dovo did not read the source.',
    }
    if (!input.sourceUnchanged) {
      if (automatic)
        result.unexercised.push(
          'Unchanged source content. An automatic run then ends without work.',
        )
      return step
    }
    if (!automatic) {
      step.note = 'Manual runs always continue, so the unchanged sample has no effect.'
      return step
    }
    result.outcome = 'unchanged'
    step.note = 'The sample is unchanged, so an automatic run ends here without work.'
    result.unexercised.push('Changed source content, which runs the steps.')
    return step
  }

  function taskStep(node: AutomationNode, stop: boolean): DryRunStep {
    const data = node.data
    const inputs: DryRunStep['inputs'] = []
    if (data.botId) {
      const bot = context.workspace.tasks.find(
        (task) => task.id === data.botId && task.bot && !task.archivedAt,
      )
      inputs.push(
        { name: 'Destination', value: `Isolated worker for the Bot "${bot?.title ?? data.botId}"` },
        { name: 'Settings', value: "The Bot's saved harness, permissions and notes" },
      )
      if (input.scheduledFor) inputs.push({ name: 'Due time', value: input.scheduledFor })
      if (bot && botPaused(bot))
        result.warnings.push(
          `The Bot "${bot.title}" is paused. A real run fails "${data.label}" until you resume it.`,
        )
    } else {
      const repositories = context.workspace.repositories
      const agent = resolveTaskAgent({ ...data, id: node.id }, context.workspace.agents)
      inputs.push(
        { name: 'Destination', value: 'New thread for this run' },
        {
          name: 'Project',
          value: projectDisplayName(repositories.find((repo) => repo.id === data.repositoryId)),
        },
        {
          name: 'Checkout',
          value: data.execution === 'worktree' ? 'New worktree' : 'Local checkout',
        },
        {
          name: 'Agent',
          value: agent
            ? [agent.name, agent.model, agent.permission].filter(Boolean).join(' · ')
            : 'Project default',
        },
      )
      if (data.linkedCheckouts?.length)
        inputs.push({
          name: 'Linked projects',
          value: data.linkedCheckouts
            .map((link) =>
              projectDisplayName(repositories.find((repo) => repo.id === link.repositoryId)),
            )
            .join(', '),
        })
    }
    inputs.push({
      name: 'Instructions',
      value: taskStepObjective(data.objective, { triggerPayload, ...source }),
    })
    if (data.inputFrom?.length)
      inputs.push({
        name: 'Preceding step inputs',
        value: `${data.inputFrom.join(', ')}${data.inputFiles ? ' with files' : ' as text'}. Real results are read only during a real run.`,
      })
    return {
      nodeId: node.id,
      label: data.label,
      kind: data.kind,
      status: 'simulated',
      inputs,
      output: stop
        ? 'Simulated failure. The run stops here.'
        : 'Simulated. No thread was created and no agent ran.',
    }
  }
}

function triggerStep(
  node: AutomationNode,
  input: AutomationDryRun['input'],
  payload: unknown,
  result: AutomationDryRun,
): DryRunStep {
  const data = node.data
  const github = data.trigger === 'github' ? data.github : undefined
  const step: DryRunStep = {
    nodeId: node.id,
    label: data.label,
    kind: data.kind,
    status: 'ran',
    inputs: [
      {
        name: 'Trigger',
        value:
          data.trigger === 'schedule'
            ? `Schedule ${data.schedule} (${data.timezone})`
            : data.trigger === 'once'
              ? `One time ${data.runAt ?? ''} (${data.timezone})`
              : data.trigger === 'webhook'
                ? 'Webhook delivery'
                : github
                  ? `GitHub ${githubEventChoices.find((item) => item.id === github.event)?.name ?? github.event} in ${github.repository}`
                  : 'Manual start',
      },
    ],
    output:
      payload !== undefined
        ? "The trigger data is added to each task's instructions."
        : data.trigger === 'schedule' || data.trigger === 'once'
          ? 'Bot workers receive the due time.'
          : 'No trigger data.',
  }
  if (data.trigger === 'schedule' || data.trigger === 'once')
    step.inputs.push({ name: 'Due time', value: input.scheduledFor ?? 'Not set' })
  if (payload !== undefined)
    step.inputs.push({ name: 'Trigger data', value: triggerContext(payload) })
  if (!github) return step
  if (github.actor) {
    const actor =
      payload && typeof payload === 'object' && 'actor' in payload ? payload.actor : undefined
    if (typeof actor !== 'string' || actor.toLowerCase() !== github.actor.toLowerCase()) {
      result.outcome = 'filtered'
      step.note = `${typeof actor === 'string' ? `The event actor "${actor}" does not match` : 'The event has no actor to match'} the actor filter "${github.actor}". A real poll skips this event.`
      result.unexercised.push(`An event from "${github.actor}", which the filter accepts.`)
    } else result.unexercised.push('An event from another actor, which the filter skips.')
  }
  if (github.label)
    result.unexercised.push(
      `The label filter "${github.label}". GitHub checks the current labels when it polls.`,
    )
  if (github.requireWriteAccess)
    result.unexercised.push('The write access check for the event actor. It needs GitHub.')
  return step
}
