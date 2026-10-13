import { useState } from 'react'
import { Button, ChoicePicker } from '@dovo/studio-ui'
import { useWorkspace, type Task } from '@dovo/studio-core'
import {
  randomUUID,
  compareCodeReviews,
  supportsAccess,
  approvalIsCurrent,
  type CodeFinding,
} from '@dovo/protocol'
import type { TaskReviewController } from './use-task-review'
export type ReviewTab = 'diff' | 'findings' | 'verification'
export function CodeReviewReport({
  task,
  review,
  tab,
  onTab,
  onOpen,
  onSince,
  presentation = 'full',
  scope = 'working',
}: {
  presentation?: 'full' | 'controls' | 'panel'
  scope?: 'working' | 'branch'
  task: Task
  review: TaskReviewController
  tab: ReviewTab
  onTab: (tab: ReviewTab) => void
  onOpen: (finding: CodeFinding) => void
  onSince: (id: string) => void
}) {
  const { workspace, connected, snapshot } = useWorkspace()
  const [agentId, setAgentId] = useState(''),
    [selectedId, setSelectedId] = useState('')
  if (!snapshot?.codeReviewsEnabled) return null
  const reports = review.report?.reviews ?? [],
    latest = reports[0],
    selected = reports.find((report) => report.id === selectedId) ?? latest
  const previous = selected
    ? reports.slice(reports.indexOf(selected) + 1).find((report) => report.status === 'completed')
    : undefined
  const comparison =
    selected?.status === 'completed' ? compareCodeReviews(selected, previous) : null
  const open =
    selected?.findings.filter(
      (finding) => finding.status === 'open' || finding.status === 'addressed',
    ) ?? []
  const disabled =
    !connected || review.busy || task.status === 'running' || latest?.status === 'running'
  return (
    <div
      className={
        tab === 'diff' || presentation === 'controls'
          ? 'shrink-0 border-b'
          : 'flex min-h-0 flex-1 flex-col border-b'
      }
    >
      {presentation !== 'panel' && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2">
          <div role="tablist" aria-label="Code review" className="flex gap-1">
            {(['diff', 'findings', 'verification'] as const).map((value) => (
              <Button
                key={value}
                role="tab"
                aria-selected={tab === value}
                size="sm"
                variant={tab === value ? 'secondary' : 'ghost'}
                className="h-8 text-xs"
                onClick={() => onTab(value)}
              >
                {value === 'diff'
                  ? 'Diff & comments'
                  : value === 'findings'
                    ? `Findings${selected ? ` (${open.length})` : ''}`
                    : 'Verification'}
              </Button>
            ))}
          </div>
          <ChoicePicker
            className="h-8 w-auto max-w-60 text-xs"
            aria-label="Reviewer configuration"
            value={agentId}
            disabled={disabled}
            onValueChange={setAgentId}
          >
            <option value="">Thread model · fresh session</option>
            {workspace.agents
              .filter((agent) => supportsAccess(agent.provider, 'read-only'))
              .map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name} · {agent.model || agent.provider}
                </option>
              ))}
          </ChoicePicker>
          <Button
            size="sm"
            className="h-8 text-xs"
            disabled={disabled || (scope === 'working' && !task.files.length)}
            onClick={() => {
              onTab('findings')
              void review.run('start', {
                requestId: randomUUID(),
                agentId: agentId || undefined,
                scope,
              })
            }}
          >
            {latest?.status === 'running'
              ? 'Reviewing…'
              : latest
                ? 'Re-review'
                : 'Independent review'}
          </Button>
          {latest?.status === 'running' && (
            <Button
              size="sm"
              variant="outline"
              disabled={review.busy || !connected}
              onClick={() => void review.run('stop', { reviewId: latest.id })}
            >
              Stop review
            </Button>
          )}
          {selected && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={() => onSince(selected.id)}
            >
              Since {selected === latest ? 'last' : 'this'} review
            </Button>
          )}
          {selected?.status === 'completed' &&
            (approvalIsCurrent(selected) ? (
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                disabled={review.busy || !connected}
                onClick={() =>
                  void review.run('approve', { reviewId: selected.id, approved: false })
                }
              >
                Approved · Undo
              </Button>
            ) : (
              <Button
                size="sm"
                className="h-8 text-xs"
                disabled={
                  review.busy ||
                  !connected ||
                  !!open.length ||
                  !(selected === latest && review.report?.current)
                }
                title={
                  open.length
                    ? 'Resolve or dismiss open findings first'
                    : selected !== latest || !review.report?.current
                      ? 'Review the current changes before approving'
                      : undefined
                }
                onClick={() =>
                  void review.run('approve', { reviewId: selected.id, approved: true })
                }
              >
                Approve changes
              </Button>
            ))}
        </div>
      )}
      {review.error && (
        <p role="alert" className="px-3 pb-2 text-xs text-destructive">
          {review.error}{' '}
          <button className="underline" onClick={() => void review.refresh()}>
            Retry
          </button>
        </p>
      )}
      {selected && !review.report?.current && selected === latest && (
        <p role="status" className="px-3 pb-2 text-xs text-amber-600 dark:text-amber-400">
          Changes have moved since this review. Run a fresh pass before relying on its findings.
        </p>
      )}
      {selected && selected !== latest && (
        <p className="px-3 pb-2 text-xs text-muted-foreground">
          Earlier review · File links open the current checkout; line numbers may have moved.
        </p>
      )}
      {tab !== 'diff' && presentation !== 'controls' && (
        <div
          className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 pb-3 text-xs"
          role="tabpanel"
          aria-label={tab === 'findings' ? 'Code review findings' : 'Code review verification'}
        >
          {reports.length > 1 && (
            <ChoicePicker
              aria-label="Review round"
              value={selected?.id ?? ''}
              onValueChange={setSelectedId}
            >
              {reports.map((report, index) => (
                <option key={report.id} value={report.id}>
                  {index === 0 ? 'Latest' : `Previous ${index}`} ·{' '}
                  {new Date(report.createdAt).toLocaleString()} · {report.status}
                </option>
              ))}
            </ChoicePicker>
          )}
          {presentation === 'panel' && selected && (
            <Button size="sm" variant="outline" onClick={() => onSince(selected.id)}>
              Inspect changes since this review
            </Button>
          )}
          {!selected && (
            <p className="text-muted-foreground">
              Start an independent review to inspect the diff and surrounding callers in a fresh
              read-only session.
            </p>
          )}
          {selected && (
            <div className="space-y-1">
              <p className="font-medium">
                {selected.reviewer} · {selected.model || 'Default model'} · {selected.status}
              </p>
              {approvalIsCurrent(selected) ? (
                <p role="status" className="text-emerald-600 dark:text-emerald-400">
                  Approved {new Date(selected.approval!.approvedAt).toLocaleString()} · Approval is
                  current for this reviewed revision.
                </p>
              ) : selected.approval ? (
                <p role="status" className="text-amber-600 dark:text-amber-400">
                  Approved revision moved or was superseded. Review approval is no longer current.
                </p>
              ) : null}
              {selected.summary && <p>{selected.summary}</p>}
              {selected.error && (
                <p role="alert" className="text-destructive">
                  {selected.error}
                </p>
              )}
              {selected.status === 'running' && (
                <p role="status" className="text-muted-foreground">
                  The reviewer is inspecting your checkout. Results are saved here without waking
                  the author.
                </p>
              )}
            </div>
          )}
          {tab === 'findings' && (
            <>
              {selected?.status === 'completed' && !selected.findings.length && (
                <p>No concrete problems reported. Check Verification for remaining uncertainty.</p>
              )}
              {comparison && previous && (
                <p className="text-muted-foreground">
                  Compared with previous review: {comparison.newFindings.length} new ·{' '}
                  {comparison.persisting.length} still reported ·{' '}
                  {comparison.noLongerReported.length} no longer reported.
                </p>
              )}
              {!!open.length && (
                <Button
                  size="sm"
                  disabled={disabled}
                  onClick={() =>
                    void review.run('fix', {
                      reviewId: selected!.id,
                      findingIds: open.map((finding) => finding.id),
                      messageId: randomUUID(),
                    })
                  }
                >
                  Ask author to fix all
                </Button>
              )}
              {selected?.findings.map((finding) => (
                <article key={finding.id} className="space-y-2 rounded-lg border bg-card p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={
                        finding.severity === 'high' ? 'text-destructive' : 'text-muted-foreground'
                      }
                    >
                      {finding.severity.toUpperCase()}
                    </span>
                    <span className="text-muted-foreground">
                      {finding.status === 'addressed'
                        ? 'Fix requested · needs re-review'
                        : finding.status === 'resolved'
                          ? 'Resolved manually'
                          : finding.status}
                    </span>
                  </div>
                  <button
                    className="text-left font-mono text-primary underline"
                    onClick={() => onOpen(finding)}
                  >
                    {finding.path}:{finding.line}
                  </button>
                  <p className="font-medium">{finding.title}</p>
                  <details>
                    <summary className="cursor-pointer text-muted-foreground">
                      Evidence & suggested fix
                    </summary>
                    <p className="mt-2">
                      <strong>Trigger:</strong> {finding.trigger}
                    </p>
                    <p>
                      <strong>Impact:</strong> {finding.impact}
                    </p>
                    <p>
                      <strong>Suggested fix:</strong> {finding.suggestion}
                    </p>
                  </details>
                  {finding.resolution && (
                    <p className="text-muted-foreground">{finding.resolution}</p>
                  )}
                  {finding.status === 'addressed' && (
                    <Button size="sm" variant="outline" onClick={() => onSince(selected!.id)}>
                      Inspect fix delta
                    </Button>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={
                        disabled || finding.status === 'resolved' || finding.status === 'dismissed'
                      }
                      onClick={() =>
                        void review.run('fix', {
                          reviewId: selected!.id,
                          findingIds: [finding.id],
                          messageId: randomUUID(),
                        })
                      }
                    >
                      Ask author to fix
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={!connected || review.busy}
                      onClick={() =>
                        void review.run('finding', {
                          reviewId: selected!.id,
                          findingId: finding.id,
                          status: finding.status === 'resolved' ? 'open' : 'resolved',
                        })
                      }
                    >
                      {finding.status === 'resolved' ? 'Reopen' : 'Resolve manually'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!connected || review.busy}
                      onClick={() =>
                        void review.run('finding', {
                          reviewId: selected!.id,
                          findingId: finding.id,
                          status: finding.status === 'dismissed' ? 'open' : 'dismissed',
                        })
                      }
                    >
                      {finding.status === 'dismissed' ? 'Restore' : 'Dismiss'}
                    </Button>
                  </div>
                </article>
              ))}
              {comparison?.noLongerReported.map((finding) => (
                <details key={finding.id} className="rounded border p-2">
                  <summary>
                    {selected?.verifiedFixes?.some((fix) => fix.findingId === finding.id)
                      ? 'Fix verified by reviewer'
                      : 'No longer reported'}{' '}
                    · {finding.path}:{finding.line} — {finding.title}
                  </summary>
                  <p className="pt-2 text-muted-foreground">
                    {selected?.verifiedFixes?.find((fix) => fix.findingId === finding.id)
                      ?.evidence ??
                      'Absent from this pass; inspect the change before marking the original finding resolved.'}
                  </p>
                  {selected?.verifiedFixes?.find((fix) => fix.findingId === finding.id) && (
                    <p className="pt-2 font-mono">
                      {selected.verifiedFixes.find((fix) => fix.findingId === finding.id)?.command}{' '}
                      ·{' '}
                      {review.report?.current && selected === latest
                        ? 'passed on reviewed revision'
                        : 'older evidence · rerun checks'}
                    </p>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={review.busy || !connected}
                    onClick={() =>
                      void review.run('finding', {
                        reviewId: previous!.id,
                        findingId: finding.id,
                        status: 'resolved',
                        resolution: 'Manually resolved after inspecting the follow-up review',
                      })
                    }
                  >
                    Mark original resolved
                  </Button>
                </details>
              ))}
            </>
          )}
          {tab === 'verification' && (
            <>
              <p className="text-muted-foreground">
                Recorded command results, separate from the reviewer’s conclusions. An older or
                unknown revision does not verify the current diff.
              </p>
              {selected?.notVerified.length ? (
                <div className="rounded border p-3">
                  <h3 className="mb-2 font-medium">Not verified by the reviewer</h3>
                  <ul className="list-disc space-y-1 pl-4">
                    {selected.notVerified.map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {!review.report?.commands.length && (
                <p>No command evidence recorded. Tests and manual behavior remain unverified.</p>
              )}
              {review.report?.commands.map((command) => (
                <details key={command.id} className="rounded border p-3">
                  <summary className="break-all">
                    <span
                      className={
                        command.status === 'passed'
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : command.status === 'failed'
                            ? 'text-destructive'
                            : 'text-muted-foreground'
                      }
                    >
                      {command.status === 'unknown' ? 'Exit status unknown' : command.status}
                    </span>{' '}
                    · <code>{command.command}</code>
                    <span className="mt-1 block text-muted-foreground">
                      {command.source} · {new Date(command.time).toLocaleString()} ·{' '}
                      {command.revision && command.revision === selected?.baseline
                        ? command.source === 'reviewer'
                          ? review.report?.current && selected === latest
                            ? 'Current reviewed snapshot · read-only session'
                            : 'Older reviewed snapshot · rerun checks'
                          : 'Turn producing reviewed snapshot (check timing unknown)'
                        : command.revision
                          ? 'Earlier revision'
                          : 'Revision not recorded'}
                      {command.exitCode !== undefined ? ` · exit ${command.exitCode}` : ''}
                    </span>
                  </summary>
                  <pre className="mt-2 whitespace-pre-wrap break-all text-[0.6875rem]">
                    {command.output || 'No output recorded.'}
                  </pre>
                </details>
              ))}
              {review.report?.evidenceLimited && (
                <p className="text-muted-foreground">
                  Only the most recent command evidence is shown.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
