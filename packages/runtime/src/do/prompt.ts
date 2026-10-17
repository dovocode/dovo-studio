import { DO_LIMITS, type DoItem, type DoRun } from '@dovo/protocol'

const GOAL_EXCERPT = 2000

const excerpt = (text: string, limit: number) =>
  text.length > limit ? `${text.slice(0, limit)}\n[Truncated]` : text

/** Context from completed dependencies, bounded per item and in total. */
function upstreamContext(run: DoRun, item: DoItem) {
  let budget = DO_LIMITS.upstreamContext
  const sections: string[] = []
  for (const id of item.dependsOn) {
    const dependency = run.items.find((candidate) => candidate.id === id)
    if (!dependency) continue
    const result = dependency.state.result
    const summary = result?.summary ?? ''
    const shortened = summary.length > DO_LIMITS.upstreamSummary
    const section = [
      `### ${dependency.title} (${dependency.id})`,
      `Computer: ${dependency.target.runtimeId}; project: ${dependency.target.repositoryId}${dependency.state.taskId ? `; thread: ${dependency.state.taskId}` : ''}`,
      result?.branch
        ? `Branch checked out when it finished: ${result.branch} (may not contain uncommitted changes)`
        : 'Branch: not recorded',
      summary
        ? `Agent-reported summary${result?.truncated || shortened ? ' (excerpt)' : ''}:\n${shortened ? summary.slice(-DO_LIMITS.upstreamSummary) : summary}`
        : 'No agent summary was recorded.',
    ].join('\n')
    if (section.length > budget) {
      sections.push('[Further upstream context omitted; open the upstream threads for details.]')
      break
    }
    budget -= section.length
    sections.push(section)
  }
  return sections.join('\n\n')
}

/** The complete message for one attempt. Retries continue in the original thread. */
export function doItemPrompt(run: DoRun, item: DoItem, attempt: number) {
  const upstream = upstreamContext(run, item)
  const previous = item.state.error ? `ended with: ${item.state.error}` : 'did not finish'
  return [
    `Dovo Do work item "${item.title}" (${item.id}), attempt ${attempt}, in the run "${run.title}".`,
    attempt > 1
      ? `This thread already worked on this item; the previous attempt ${previous}. Inspect the current thread and checkout first, keep work that is already done, and continue.`
      : '',
    `Run goal:\n${excerpt(run.goal, GOAL_EXCERPT)}`,
    `Instructions:\n${item.instructions}`,
    upstream
      ? [
          'Upstream results. They are agent-reported and unverified.',
          'Dependency results are not copied into this checkout. Upstream work may sit in another worktree or on another computer, and a recorded branch may not contain uncommitted changes. Inspect the actual upstream files or commits with the tools you are authorized to use before relying on them. If you cannot reach them, ask the human instead of assuming the changes are present.',
          upstream,
        ].join('\n\n')
      : '',
    'Finish with a concise summary of what you changed, the branch or files involved, and anything you could not verify. Do not merge, publish or push to shared branches unless these instructions explicitly ask for it; a human reviews the run.',
  ]
    .filter(Boolean)
    .join('\n\n')
}
