import type { Task } from '../../workspace.js'

/** Added to the newest review request in the agent's prompt. */
export const REVIEW_MODE_INSTRUCTION =
  'Review mode: review the uncommitted changes in this checkout (use git status and git diff, and read untracked files) like a careful senior reviewer. Do not edit files. List each problem on its own line exactly as "- path/to/file:LINE — what is wrong and how to fix it", most important first, with line numbers from the current files. If you find no problems, say so.'
export const REVIEW_PROMPT = 'Review the changes so far.'

export type ReviewFinding = { path: string; line: number; text: string }

/** "- src/a.ts:12 — problem" lines, with optional backticks and a range end. */
export function parseReviewFindings(reply: string): ReviewFinding[] {
  const findings: ReviewFinding[] = []
  for (const line of reply.split('\n')) {
    const match = /^\s*(?:[-*]|\d+\.)\s+`?([^\s`:]+):(\d+)(?:-\d+)?`?\s*(?:—|–|-|:)\s*(.+)$/.exec(
      line,
    )
    if (match) findings.push({ path: match[1], line: Number(match[2]), text: match[3].trim() })
  }
  return findings.slice(0, 50)
}

/** Findings from the agent's reply to the newest review request, once that turn finished. */
export function reviewFindings(task: Pick<Task, 'messages' | 'status'>): ReviewFinding[] {
  if (task.status === 'running') return []
  let request = -1
  for (let index = task.messages.length - 1; index >= 0; index--)
    if (task.messages[index].role === 'user' && task.messages[index].review) {
      request = index
      break
    }
  if (request < 0) return []
  // A later message from the user (for example "Fix these") closes the review.
  const after = task.messages.slice(request + 1)
  if (after.some((message) => message.role === 'user')) return []
  return after
    .filter((message) => message.role === 'assistant')
    .flatMap((message) => parseReviewFindings(message.text))
}

export function fixFindingsPrompt(findings: readonly ReviewFinding[]) {
  return `Fix these review findings:\n${findings.map((finding) => `- ${finding.path}:${finding.line} — ${finding.text}`).join('\n')}`
}
