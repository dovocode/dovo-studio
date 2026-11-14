import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
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
  const uiText = useInterfaceText()

  const { snapshot, connected } = useRuntime(),
    { styles, colors } = useTheme()
  const [agentId, setAgentId] = useState(''),
    [selectedId, setSelectedId] = useState(''),
    [expandedCommand, setExpandedCommand] = useState(''),
    [optionsOpen, setOptionsOpen] = useState(false),
    [expandedFinding, setExpandedFinding] = useState('')
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
                ? uiText('Diff & comments')
                : value === 'findings'
                  ? uiText('Findings{value0}', { value0: selected ? ` (${open.length})` : '' })
                  : uiText('Verification')
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
            label={scope === 'branch' ? uiText('Branch + local edits') : uiText('Local edits')}
            disabled={editing || review.busy}
            onPress={() => onScope(scope === 'working' ? 'branch' : 'working')}
          />
        )}
        <Action
          secondary
          label={optionsOpen ? uiText('Hide review options') : uiText('Review options')}
          onPress={() => setOptionsOpen(!optionsOpen)}
        />
      </View>
      {optionsOpen && (
        <Choice
          label={uiText('Reviewer configuration')}
          value={agentId}
          disabled={disabled}
          items={[
            { id: '', name: uiText('Thread model · fresh session') },
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
              ? uiText('Reviewing…')
              : latest
                ? uiText('Re-review')
                : uiText('Independent review')
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
            label={uiText('Stop review')}
            disabled={review.busy || !connected}
            onPress={() => void review.run('stop', { reviewId: latest.id })}
          />
        )}
        {selected && (
          <Action
            secondary
            label={selected === latest ? uiText('Since last review') : uiText('Since this review')}
            disabled={editing || review.busy}
            onPress={() => onSince(selected.id)}
          />
        )}
        {selected?.status === 'completed' &&
          (approvalIsCurrent(selected) ? (
            <Action
              secondary
              label={uiText('Approved · Undo')}
              disabled={review.busy || !connected || editing}
              onPress={() => void review.run('approve', { reviewId: selected.id, approved: false })}
            />
          ) : (
            <Action
              label={uiText('Approve changes')}
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
            <InterfaceText
              values={{ value0: new Date(selected.approval!.approvedAt).toLocaleString() }}
            >
              {'Approved {value0} · This reviewed revision.'}
            </InterfaceText>
          </Text>
        ) : selected.approval ? (
          <Text accessibilityRole="alert" style={styles.muted}>
            <InterfaceText>
              {'Approved revision moved or was superseded. Review approval is no longer current.'}
            </InterfaceText>
          </Text>
        ) : open.length ? (
          <Text style={styles.muted}>
            <InterfaceText>{'Resolve or dismiss open findings to approve changes.'}</InterfaceText>
          </Text>
        ) : null)}
      {!!review.error && (
        <>
          <Text accessibilityRole="alert" style={styles.error}>
            {review.error}
          </Text>
          <Action
            secondary
            label={uiText('Retry review report')}
            onPress={() => void review.refresh()}
          />
        </>
      )}
      {selected === latest && latest && !review.report?.current && (
        <Text style={styles.muted}>
          <InterfaceText>
            {
              'Changes have moved since this review. Run a fresh pass before relying on its findings.'
            }
          </InterfaceText>
        </Text>
      )}
      {selected && selected !== latest && (
        <Text style={styles.muted}>
          <InterfaceText>
            {'Earlier review · File links open the current checkout; line numbers may have moved.'}
          </InterfaceText>
        </Text>
      )}
    </View>
  )
  const content = (
    <View style={{ gap: 12, paddingHorizontal: 16, paddingBottom: 16 }}>
      {reports.length > 1 && (
        <Choice
          label={uiText('Review round')}
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
          <InterfaceText>
            {'Start a fresh read-only review of the diff and its surrounding callers.'}
          </InterfaceText>
        </Text>
      )}
      {selected && (
        <View style={{ gap: 6 }}>
          <Text style={styles.text}>
            {selected.reviewer} · {selected.model || uiText('Default model')} · {selected.status}
          </Text>
          {!!selected.summary && <Text style={styles.text}>{selected.summary}</Text>}
          {!!selected.error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {selected.error}
            </Text>
          )}
          {selected.status === 'running' && (
            <Text style={styles.muted}>
              <InterfaceText>
                {
                  'The reviewer is inspecting the checkout. Results appear here without waking the author.'
                }
              </InterfaceText>
            </Text>
          )}
        </View>
      )}
      {tab === 'findings' && (
        <>
          {selected?.status === 'completed' && !selected.findings.length && (
            <Text style={styles.text}>
              <InterfaceText>
                {'No concrete problems reported. Check Verification for remaining uncertainty.'}
              </InterfaceText>
            </Text>
          )}
          {comparison && previous && (
            <Text style={styles.muted}>
              <InterfaceText
                values={{
                  value0: comparison.newFindings.length,
                  value1: comparison.persisting.length,
                  value2: comparison.noLongerReported.length,
                }}
              >
                {'{value0} new · {value1} still reported · {value2} no longer reported.'}
              </InterfaceText>
            </Text>
          )}
          {!!open.length && (
            <Action
              label={uiText('Ask author to fix all')}
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
                  ? uiText('Fix requested · needs re-review')
                  : finding.status === 'resolved'
                    ? uiText('Resolved manually')
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
                  expandedFinding === finding.id
                    ? uiText('Hide evidence')
                    : uiText('Evidence & suggested fix')
                }
                onPress={() => setExpandedFinding(expandedFinding === finding.id ? '' : finding.id)}
              />
              {expandedFinding === finding.id && (
                <View style={{ gap: 6 }}>
                  <Text style={styles.text}>
                    <InterfaceText values={{ value0: finding.trigger }}>
                      {'Trigger: {value0}'}
                    </InterfaceText>
                  </Text>
                  <Text style={styles.text}>
                    <InterfaceText values={{ value0: finding.impact }}>
                      {'Impact: {value0}'}
                    </InterfaceText>
                  </Text>
                  <Text style={styles.text}>
                    <InterfaceText values={{ value0: finding.suggestion }}>
                      {'Suggested fix: {value0}'}
                    </InterfaceText>
                  </Text>
                </View>
              )}
              {!!finding.resolution && <Text style={styles.muted}>{finding.resolution}</Text>}
              {finding.status === 'addressed' && (
                <Action
                  secondary
                  label={uiText('Inspect fix delta')}
                  disabled={editing || review.busy}
                  onPress={() => onSince(selected!.id)}
                />
              )}
              <View style={[styles.row, { flexWrap: 'wrap' }]}>
                <Action
                  label={uiText('Ask author to fix')}
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
                  label={
                    finding.status === 'resolved' ? uiText('Reopen') : uiText('Resolve manually')
                  }
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
                  label={finding.status === 'dismissed' ? uiText('Restore') : uiText('Dismiss')}
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
                  ? uiText('Fix verified by reviewer')
                  : uiText('No longer reported')}{' '}
                · {finding.path}:{finding.line} — {finding.title}
              </Text>
              <Text style={styles.muted}>
                {selected?.verifiedFixes?.find((fix) => fix.findingId === finding.id)?.evidence ??
                  uiText(
                    'Absent from this pass; inspect the change before marking the original finding resolved.',
                  )}
              </Text>
              {selected?.verifiedFixes?.find((fix) => fix.findingId === finding.id) && (
                <Text style={styles.muted}>
                  {selected.verifiedFixes.find((fix) => fix.findingId === finding.id)?.command} ·{' '}
                  {review.report?.current && selected === latest
                    ? uiText('passed on reviewed revision')
                    : uiText('older evidence · rerun checks')}
                </Text>
              )}
              <Action
                secondary
                label={uiText('Mark original resolved')}
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
            <InterfaceText>
              {
                'Recorded command results, separate from reviewer conclusions. An older or unknown revision does not verify the current diff.'
              }
            </InterfaceText>
          </Text>
          {!!selected?.notVerified.length && (
            <View style={[styles.card, { gap: 6 }]}>
              <Text style={[styles.text, { fontWeight: '600' }]}>
                <InterfaceText>{'Not verified by the reviewer'}</InterfaceText>
              </Text>
              {selected.notVerified.map((item, index) => (
                <Text key={index} style={styles.text}>
                  • {item}
                </Text>
              ))}
            </View>
          )}
          {!review.report?.commands.length && (
            <Text style={styles.text}>
              <InterfaceText>
                {'No command evidence recorded. Tests and manual behavior remain unverified.'}
              </InterfaceText>
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
                {command.status === 'unknown' ? uiText('Exit status unknown') : command.status}
                {command.exitCode !== undefined
                  ? uiText(' · exit {value0}', { value0: command.exitCode })
                  : ''}
              </Text>
              <Text selectable style={styles.text}>
                {command.command}
              </Text>
              <Text style={styles.muted}>
                {command.source} · {new Date(command.time).toLocaleString()} ·{' '}
                {command.revision && command.revision === selected?.baseline
                  ? command.source === 'reviewer'
                    ? review.report?.current && selected === latest
                      ? uiText('Current reviewed snapshot · read-only session')
                      : uiText('Older reviewed snapshot · rerun checks')
                    : uiText('Turn producing reviewed snapshot (check timing unknown)')
                  : command.revision
                    ? uiText('Earlier revision')
                    : uiText('Revision not recorded')}
              </Text>
              <Action
                secondary
                label={
                  expandedCommand === command.id ? uiText('Hide output') : uiText('Show output')
                }
                onPress={() => setExpandedCommand(expandedCommand === command.id ? '' : command.id)}
              />
              {expandedCommand === command.id && (
                <Text selectable style={styles.muted}>
                  {command.output || uiText('No output recorded.')}
                </Text>
              )}
            </View>
          ))}
          {review.report?.evidenceLimited && (
            <Text style={styles.muted}>
              <InterfaceText>{'Only the most recent command evidence is shown.'}</InterfaceText>
            </Text>
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
            {review.report?.current
              ? uiText('Reviewed revision')
              : uiText('Older review · line may have moved')}
          </Text>
          <Action secondary label={uiText('Finding details')} onPress={() => onTab('findings')} />
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
