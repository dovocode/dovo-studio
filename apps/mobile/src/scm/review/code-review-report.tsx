import { useState } from 'react'
import { ScrollView, View } from 'react-native'
import { randomUUID } from 'expo-crypto'
import {
  compareCodeReviews,
  supportsAccess,
  approvalIsCurrent,
  type Task,
  type CodeFinding,
} from '@dovo/protocol'
import { useRuntime } from '../../runtime/connection/provider'
import { useTheme } from '../../ui/theme'
import { Text } from '../../ui/content/text'
import { Action } from '../../ui/controls/action'
import { Choice } from '../../ui/controls/choice'
import type { TaskReviewController } from './use-task-review'
export type ReviewTab = 'diff' | 'findings' | 'verification'
export function CodeReviewReport({
  task,
  review,
  tab,
  onTab,
  onOpen,
  onSince,
  editing = false,
  scope = 'working',
  onScope,
  focusedFinding,
}: {
  scope?: 'working' | 'branch'
  onScope?: (scope: 'working' | 'branch') => void
  focusedFinding?: CodeFinding
  task: Task
  review: TaskReviewController
  tab: ReviewTab
  onTab: (tab: ReviewTab) => void
  onOpen: (finding: CodeFinding) => void
  onSince: (id: string) => void
  editing?: boolean
}) {
  const { snapshot, connected } = useRuntime(),
    { styles, colors } = useTheme()
  const [agentId, setAgentId] = useState(''),
    [selectedId, setSelectedId] = useState(''),
    [expandedCommand, setExpandedCommand] = useState(''),
    [optionsOpen, setOptionsOpen] = useState(false),
    [expandedFinding, setExpandedFinding] = useState('')
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
    !connected ||
    review.busy ||
    editing ||
    task.status === 'running' ||
    latest?.status === 'running'
  const controls = (
    <View style={{ gap: 8, paddingHorizontal: 16, paddingVertical: 10 }}>
      <View style={[styles.row, { flexWrap: 'wrap' }]}>
        {(['diff', 'findings', 'verification'] as const).map((value) => (
          <Action
            key={value}
            label={
              value === 'diff'
                ? 'Diff & comments'
                : value === 'findings'
                  ? `Findings${selected ? ` (${open.length})` : ''}`
                  : 'Verification'
            }
            secondary={tab !== value}
            disabled={editing}
            onPress={() => onTab(value)}
          />
        ))}
      </View>
      <View style={[styles.row, { flexWrap: 'wrap' }]}>
        {onScope && (
          <Action
            secondary
            label={scope === 'branch' ? 'Branch + local edits' : 'Local edits'}
            disabled={editing || review.busy}
            onPress={() => onScope(scope === 'working' ? 'branch' : 'working')}
          />
        )}
        <Action
          secondary
          label={optionsOpen ? 'Hide review options' : 'Review options'}
          onPress={() => setOptionsOpen(!optionsOpen)}
        />
      </View>
      {optionsOpen && (
        <Choice
          label="Reviewer configuration"
          value={agentId}
          disabled={disabled}
          items={[
            { id: '', name: 'Thread model · fresh session' },
            ...(snapshot?.workspace.agents
              .filter((agent) => supportsAccess(agent.provider, 'read-only'))
              .map((agent) => ({
                id: agent.id,
                name: `${agent.name} · ${agent.model || agent.provider}`,
              })) ?? []),
          ]}
          onChange={setAgentId}
        />
      )}
      <View style={[styles.row, { flexWrap: 'wrap' }]}>
        <Action
          label={
            latest?.status === 'running'
              ? 'Reviewing…'
              : latest
                ? 'Re-review'
                : 'Independent review'
          }
          disabled={disabled || (scope === 'working' && !task.files.length)}
          onPress={() => {
            onTab('findings')
            void review.run('start', {
              requestId: randomUUID(),
              agentId: agentId || undefined,
              scope,
            })
          }}
        />
        {latest?.status === 'running' && (
          <Action
            secondary
            label="Stop review"
            disabled={review.busy || !connected}
            onPress={() => void review.run('stop', { reviewId: latest.id })}
          />
        )}
        {selected && (
          <Action
            secondary
            label={selected === latest ? 'Since last review' : 'Since this review'}
            disabled={editing || review.busy}
            onPress={() => onSince(selected.id)}
          />
        )}
        {selected?.status === 'completed' &&
          (approvalIsCurrent(selected) ? (
            <Action
              secondary
              label="Approved · Undo"
              disabled={review.busy || !connected || editing}
              onPress={() => void review.run('approve', { reviewId: selected.id, approved: false })}
            />
          ) : (
            <Action
              label="Approve changes"
              disabled={
                review.busy ||
                !connected ||
                editing ||
                !!open.length ||
                !(selected === latest && review.report?.current)
              }
              onPress={() => void review.run('approve', { reviewId: selected.id, approved: true })}
            />
          ))}
      </View>
      {selected?.status === 'completed' &&
        (approvalIsCurrent(selected) ? (
          <Text accessibilityRole="summary" style={styles.muted}>
            Approved {new Date(selected.approval!.approvedAt).toLocaleString()} · Commit &amp; push
            enabled for this reviewed revision.
          </Text>
        ) : selected.approval ? (
          <Text accessibilityRole="alert" style={styles.muted}>
            Approved revision moved or was superseded. Re-review before pushing.
          </Text>
        ) : open.length ? (
          <Text style={styles.muted}>Resolve or dismiss open findings to approve changes.</Text>
        ) : null)}
      {!!review.error && (
        <>
          <Text accessibilityRole="alert" style={styles.error}>
            {review.error}
          </Text>
          <Action secondary label="Retry review report" onPress={() => void review.refresh()} />
        </>
      )}
      {selected === latest && latest && !review.report?.current && (
        <Text style={styles.muted}>
          Changes have moved since this review. Run a fresh pass before relying on its findings.
        </Text>
      )}
      {selected && selected !== latest && (
        <Text style={styles.muted}>
          Earlier review · File links open the current checkout; line numbers may have moved.
        </Text>
      )}
    </View>
  )
  const content = (
    <View style={{ gap: 12, paddingHorizontal: 16, paddingBottom: 16 }}>
      {reports.length > 1 && (
        <Choice
          label="Review round"
          value={selected?.id ?? ''}
          items={reports.map((report, index) => ({
            id: report.id,
            name: `${index === 0 ? 'Latest' : `Previous ${index}`} · ${new Date(report.createdAt).toLocaleString()} · ${report.status}`,
          }))}
          onChange={setSelectedId}
        />
      )}
      {!selected && (
        <Text style={styles.muted}>
          Start a fresh read-only review of the diff and its surrounding callers.
        </Text>
      )}
      {selected && (
        <View style={{ gap: 6 }}>
          <Text style={styles.text}>
            {selected.reviewer} · {selected.model || 'Default model'} · {selected.status}
          </Text>
          {!!selected.summary && <Text style={styles.text}>{selected.summary}</Text>}
          {!!selected.error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {selected.error}
            </Text>
          )}
          {selected.status === 'running' && (
            <Text style={styles.muted}>
              The reviewer is inspecting the checkout. Results appear here without waking the
              author.
            </Text>
          )}
        </View>
      )}
      {tab === 'findings' && (
        <>
          {selected?.status === 'completed' && !selected.findings.length && (
            <Text style={styles.text}>
              No concrete problems reported. Check Verification for remaining uncertainty.
            </Text>
          )}
          {comparison && previous && (
            <Text style={styles.muted}>
              {comparison.newFindings.length} new · {comparison.persisting.length} still reported ·{' '}
              {comparison.noLongerReported.length} no longer reported.
            </Text>
          )}
          {!!open.length && (
            <Action
              label="Ask author to fix all"
              disabled={disabled}
              onPress={() =>
                void review.run('fix', {
                  reviewId: selected!.id,
                  findingIds: open.map((finding) => finding.id),
                  messageId: randomUUID(),
                })
              }
            />
          )}
          {selected?.findings.map((finding) => (
            <View key={finding.id} style={[styles.card, { gap: 8 }]}>
              <Text style={{ color: finding.severity === 'high' ? colors.error : colors.muted }}>
                {finding.severity.toUpperCase()} ·{' '}
                {finding.status === 'addressed'
                  ? 'Fix requested · needs re-review'
                  : finding.status === 'resolved'
                    ? 'Resolved manually'
                    : finding.status}
              </Text>
              <Action
                secondary
                label={`${finding.path}:${finding.line}`}
                onPress={() => onOpen(finding)}
              />
              <Text style={[styles.text, { fontWeight: '600' }]}>{finding.title}</Text>
              <Action
                secondary
                label={
                  expandedFinding === finding.id ? 'Hide evidence' : 'Evidence & suggested fix'
                }
                onPress={() => setExpandedFinding(expandedFinding === finding.id ? '' : finding.id)}
              />
              {expandedFinding === finding.id && (
                <View style={{ gap: 6 }}>
                  <Text style={styles.text}>Trigger: {finding.trigger}</Text>
                  <Text style={styles.text}>Impact: {finding.impact}</Text>
                  <Text style={styles.text}>Suggested fix: {finding.suggestion}</Text>
                </View>
              )}
              {!!finding.resolution && <Text style={styles.muted}>{finding.resolution}</Text>}
              {finding.status === 'addressed' && (
                <Action
                  secondary
                  label="Inspect fix delta"
                  disabled={editing || review.busy}
                  onPress={() => onSince(selected!.id)}
                />
              )}
              <View style={[styles.row, { flexWrap: 'wrap' }]}>
                <Action
                  label="Ask author to fix"
                  disabled={
                    disabled || finding.status === 'resolved' || finding.status === 'dismissed'
                  }
                  onPress={() =>
                    void review.run('fix', {
                      reviewId: selected!.id,
                      findingIds: [finding.id],
                      messageId: randomUUID(),
                    })
                  }
                />
                <Action
                  secondary
                  label={finding.status === 'resolved' ? 'Reopen' : 'Resolve manually'}
                  disabled={!connected || review.busy}
                  onPress={() =>
                    void review.run('finding', {
                      reviewId: selected!.id,
                      findingId: finding.id,
                      status: finding.status === 'resolved' ? 'open' : 'resolved',
                    })
                  }
                />
                <Action
                  secondary
                  label={finding.status === 'dismissed' ? 'Restore' : 'Dismiss'}
                  disabled={!connected || review.busy}
                  onPress={() =>
                    void review.run('finding', {
                      reviewId: selected!.id,
                      findingId: finding.id,
                      status: finding.status === 'dismissed' ? 'open' : 'dismissed',
                    })
                  }
                />
              </View>
            </View>
          ))}
          {comparison?.noLongerReported.map((finding) => (
            <View key={finding.id} style={[styles.card, { gap: 8 }]}>
              <Text style={styles.text}>
                {selected?.verifiedFixes?.some((fix) => fix.findingId === finding.id)
                  ? 'Fix verified by reviewer'
                  : 'No longer reported'}{' '}
                · {finding.path}:{finding.line} — {finding.title}
              </Text>
              <Text style={styles.muted}>
                {selected?.verifiedFixes?.find((fix) => fix.findingId === finding.id)?.evidence ??
                  'Absent from this pass; inspect the change before marking the original finding resolved.'}
              </Text>
              {selected?.verifiedFixes?.find((fix) => fix.findingId === finding.id) && (
                <Text style={styles.muted}>
                  {selected.verifiedFixes.find((fix) => fix.findingId === finding.id)?.command} ·{' '}
                  {review.report?.current && selected === latest
                    ? 'passed on reviewed revision'
                    : 'older evidence · rerun checks'}
                </Text>
              )}
              <Action
                secondary
                label="Mark original resolved"
                disabled={review.busy || !connected}
                onPress={() =>
                  void review.run('finding', {
                    reviewId: previous!.id,
                    findingId: finding.id,
                    status: 'resolved',
                    resolution: 'Resolved after inspecting the follow-up review',
                  })
                }
              />
            </View>
          ))}
        </>
      )}
      {tab === 'verification' && (
        <>
          <Text style={styles.muted}>
            Recorded command results, separate from reviewer conclusions. An older or unknown
            revision does not verify the current diff.
          </Text>
          {!!selected?.notVerified.length && (
            <View style={[styles.card, { gap: 6 }]}>
              <Text style={[styles.text, { fontWeight: '600' }]}>Not verified by the reviewer</Text>
              {selected.notVerified.map((item, index) => (
                <Text key={index} style={styles.text}>
                  • {item}
                </Text>
              ))}
            </View>
          )}
          {!review.report?.commands.length && (
            <Text style={styles.text}>
              No command evidence recorded. Tests and manual behavior remain unverified.
            </Text>
          )}
          {review.report?.commands.map((command) => (
            <View key={command.id} style={[styles.card, { gap: 6 }]}>
              <Text
                style={{
                  color:
                    command.status === 'failed'
                      ? colors.error
                      : command.status === 'passed'
                        ? colors.success
                        : colors.muted,
                }}
              >
                {command.status === 'unknown' ? 'Exit status unknown' : command.status}
                {command.exitCode !== undefined ? ` · exit ${command.exitCode}` : ''}
              </Text>
              <Text selectable style={styles.text}>
                {command.command}
              </Text>
              <Text style={styles.muted}>
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
              </Text>
              <Action
                secondary
                label={expandedCommand === command.id ? 'Hide output' : 'Show output'}
                onPress={() => setExpandedCommand(expandedCommand === command.id ? '' : command.id)}
              />
              {expandedCommand === command.id && (
                <Text selectable style={styles.muted}>
                  {command.output || 'No output recorded.'}
                </Text>
              )}
            </View>
          ))}
          {review.report?.evidenceLimited && (
            <Text style={styles.muted}>Only the most recent command evidence is shown.</Text>
          )}
        </>
      )}
    </View>
  )
  return tab === 'diff' ? (
    <View>
      {controls}
      {focusedFinding && (
        <View style={[styles.card, { marginHorizontal: 16, marginBottom: 8, gap: 6 }]}>
          <Text style={[styles.text, { fontWeight: '600' }]}>{focusedFinding.title}</Text>
          <Text style={styles.muted}>
            {focusedFinding.path}:{focusedFinding.line} ·{' '}
            {review.report?.current ? 'Reviewed revision' : 'Older review · line may have moved'}
          </Text>
          <Action secondary label="Finding details" onPress={() => onTab('findings')} />
        </View>
      )}
    </View>
  ) : (
    <ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
      {controls}
      {content}
    </ScrollView>
  )
}
