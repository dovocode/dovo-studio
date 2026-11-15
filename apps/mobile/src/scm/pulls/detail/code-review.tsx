import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useCallback, useEffect, useState } from 'react'
import { Image, Linking, View } from 'react-native'
import { prReviewIllustration, usePullCodeReview } from '@dovo/studio-core/pull-code-review'
import {
  defaultTaskHarness,
  providerSchema,
  supportsUtilities,
  resolveTitleHarness,
  titleSettingsForHarness,
  pullCodeReviewReportSchema,
  pullCodeReviewBody,
  pullFilePatch,
  pullReviewCoverageLabels,
  pullReviewReferences,
  randomUUID,
  type Agent,
  type PullDetail,
  type PullCodeReview,
} from '@dovo/protocol'
import { DiffView } from '../../../tasks/preview/diff-view'
import { useRuntime } from '../../../runtime/connection/provider'
import { ModelSettings } from '../../../agents/model-settings'
import { harnessNames } from '../../../tasks/creation/harness-choices'
import { Action } from '../../../ui/controls/action'
import { Choice } from '../../../ui/controls/choice'
import { Field } from '../../../ui/controls/field'
import { Text } from '../../../ui/content/text'
import { Sheet } from '../../../ui/layout/sheet'
import { useTheme } from '../../../ui/theme'

export function MobilePullCodeReview({
  repositoryId,
  detail,
  onAsk,
  onRefresh,
}: {
  repositoryId: string
  detail: PullDetail
  onAsk: (finding: PullCodeReview['findings'][number]) => void
  onRefresh?: () => void
}) {
  const uiText = useInterfaceText()
  const { snapshot, profile, call, connected } = useRuntime()
  const { colors, styles } = useTheme()
  const transport = useCallback(
    (path: string, input: unknown) => call(path, input, pullCodeReviewReportSchema),
    [call],
  )
  const target = {
    repositoryId,
    number: detail.pull.number,
    connectionId: detail.pull.connectionId,
    expectedDestination: detail.destination ?? detail.pull.destination ?? '',
  }
  const review = usePullCodeReview({
    target,
    scope: JSON.stringify([snapshot?.runtimeId, profile?.id]),
    request: transport,
    connected: connected && !!target.expectedDestination,
  })
  const [open, setOpen] = useState(false)
  const [settings, setSettings] = useState(false)
  const [agent, setAgent] = useState<Agent | null>(null)
  const [preview, setPreview] = useState<PullCodeReview>()
  const [patch, setPatch] = useState<string>()
  const [linkError, setLinkError] = useState('')
  const [evidence, setEvidence] = useState<string>()
  const [contextPath, setContextPath] = useState<string>()
  const agents = snapshot?.workspace.agents ?? []
  useEffect(() => {
    if (agent || !review.report?.selection) return
    const selection = review.report.selection
    const saved = resolveTitleHarness(selection, agents)
    if (saved) setAgent({ ...saved, model: selection.model, reasoning: selection.reasoning })
  }, [review.report?.selection, agent, agents])
  const current = review.review
  const draft = review.draft
  const stale =
    !!current &&
    (current.headSha !== detail.pull.headSha || current.baseSha !== detail.pull.baseSha)
  const running = review.report?.reviews.some((pass) => pass.status === 'running')
  const blocked = !connected || !target.expectedDestination || review.busy || running
  const editable =
    !!current &&
    current.status === 'completed' &&
    !current.publication &&
    !review.busy &&
    !review.publishing
  const selectedPatch = current?.coverage.find((file) => file.path === patch)
  const contextFile = current?.analysis?.contextFiles.find(
    (file) => file.ref + file.path === contextPath,
  )
  const supplied = current?.coverage.filter((file) => file.state === 'supplied').length ?? 0
  const start = (remaining = false) => {
    if (agent)
      void review.start(
        titleSettingsForHarness(agent),
        detail.pull.headSha,
        detail.pull.baseSha,
        remaining,
      )
    else setSettings(true)
  }
  return (
    <>
      <View style={[styles.card, { gap: 10 }]}>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          {!current && (
            <Image
              source={{ uri: prReviewIllustration }}
              accessibilityIgnoresInvertColors
              style={{ width: 84, height: 60, borderRadius: 8 }}
            />
          )}
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={[styles.text, { fontWeight: '600' }]}>{uiText('Agent review')}</Text>
            <Text style={[styles.muted, { fontSize: 12 }]}>
              {current
                ? uiText('{value0} · {value1} findings{value2}', {
                    value0: current.status,
                    value1: current.findings.length,
                    value2: stale ? uiText(' · older revision') : '',
                  })
                : uiText('A second look before you review.')}
            </Text>
          </View>
        </View>
        <Action
          label={current ? uiText('Open agent review') : uiText('Review with agent')}
          onPress={() => {
            setOpen(true)
            if (!current && agent?.model && !blocked) start()
          }}
        />
      </View>
      {open && (
        <Sheet
          busy={review.publishing}
          footer={
            preview !== undefined && current ? (
              <View style={{ gap: 8 }}>
                <Action
                  wide
                  label={review.publishing ? uiText('Publishing…') : uiText('Publish review')}
                  disabled={
                    !connected ||
                    stale ||
                    review.dirty ||
                    review.publishing ||
                    !!current.publication ||
                    current.id !== preview.id ||
                    current.version !== preview.version
                  }
                  onPress={() => {
                    void review
                      .command('publish', {
                        reviewId: preview.id,
                        version: preview.version,
                        requestId: randomUUID(),
                        body: pullCodeReviewBody(preview),
                      })
                      .then((result) => {
                        if (result) setPreview(undefined)
                      })
                  }}
                />
                <Action
                  secondary
                  label={uiText('Back to draft')}
                  disabled={review.publishing}
                  onPress={() => setPreview(undefined)}
                />
              </View>
            ) : selectedPatch || contextFile ? (
              <Action
                secondary
                label={uiText('Back to findings')}
                onPress={() => {
                  setPatch(undefined)
                  setContextPath(undefined)
                }}
              />
            ) : current?.status === 'completed' && !current.publication && draft ? (
              <View style={{ gap: 8 }}>
                <Text style={styles.muted}>
                  {uiText('{value0} findings in draft · {value1}', {
                    value0: draft.selected.length,
                    value1: review.dirty ? uiText('Unsaved changes') : uiText('Saved on computer'),
                  })}
                </Text>
                <Action
                  wide
                  label={review.busy ? uiText('Saving draft…') : uiText('Preview review')}
                  disabled={!connected || stale || review.busy || !draft.body.trim()}
                  onPress={() => {
                    void review.preparePreview().then((body) => {
                      if (body !== undefined) setPreview(body)
                    })
                  }}
                />
              </View>
            ) : undefined
          }
          title={
            preview !== undefined
              ? uiText('Publish your review')
              : (contextFile?.path ?? selectedPatch?.path ?? uiText('Agent review'))
          }
          onClose={() => {
            setOpen(false)
            setPreview(undefined)
            setPatch(undefined)
            setContextPath(undefined)
          }}
        >
          {review.error && (
            <View style={{ gap: 8 }}>
              <Text accessibilityRole="alert" style={styles.error}>
                {review.error}
              </Text>
              <Action
                secondary
                label={uiText('Refresh report')}
                onPress={() => {
                  onRefresh?.()
                  void review.refresh()
                }}
              />
              {review.dirty && (
                <Action
                  secondary
                  label={uiText('Retry saving draft')}
                  onPress={() => {
                    void review.save()
                  }}
                />
              )}
            </View>
          )}
          {!target.expectedDestination && (
            <Text accessibilityRole="alert" style={styles.error}>
              {uiText('Refresh this PR to verify its account before starting a review.')}
            </Text>
          )}
          {linkError && (
            <Text accessibilityRole="alert" style={styles.error}>
              {linkError}
            </Text>
          )}
          {review.notice && (
            <Text accessibilityLiveRegion="polite" style={styles.muted}>
              {review.notice}
            </Text>
          )}
          {review.draftConflict && (
            <View style={{ gap: 8 }}>
              <Text style={styles.muted}>
                {uiText('Another client saved a newer draft. Your edits are kept.')}
              </Text>
              <Text selectable style={styles.text}>
                {current?.draft.body}
              </Text>
              <Action
                secondary
                label={uiText('Save my draft over this version')}
                onPress={review.replaceSavedDraft}
              />
              <Action
                secondary
                label={uiText('Use the saved draft')}
                onPress={review.reloadDraft}
              />
            </View>
          )}
          {preview !== undefined && current ? (
            <View style={{ gap: 12 }}>
              <Text style={styles.text}>{preview.account}</Text>
              {(current.id !== preview.id || current.version !== preview.version) && (
                <Text accessibilityRole="alert" style={styles.error}>
                  {uiText('The draft changed. Return to the draft and preview it again.')}
                </Text>
              )}
              <Text style={[styles.muted, { fontSize: 12 }]}>
                {preview.url} · {preview.headSha.slice(0, 7)} ·{' '}
                {preview.draft.event === 'request-changes'
                  ? uiText('Request changes')
                  : uiText('Comment')}
              </Text>
              <Text style={styles.muted}>
                {uiText('This is the exact Markdown that will be posted under your account.')}
              </Text>
              <Text style={styles.muted}>
                {uiText(
                  'The final HTML comment lets Dovo find this review if the connection drops.',
                )}
              </Text>
              <Text selectable style={[styles.text, { fontSize: 13, lineHeight: 20 }]}>
                {pullCodeReviewBody(preview)}
              </Text>
              {pullReviewReferences(pullCodeReviewBody(preview)).length > 0 && (
                <Text style={styles.muted}>
                  {uiText('Mentions and references: {value0}', {
                    value0: pullReviewReferences(pullCodeReviewBody(preview)).join(', '),
                  })}
                </Text>
              )}
            </View>
          ) : contextFile ? (
            <View style={{ gap: 12 }}>
              <Text style={styles.muted}>
                {uiText('Snapshot at {value0}', { value0: contextFile.ref.slice(0, 7) })}
              </Text>
              <Text selectable style={styles.text}>
                {contextFile.text}
              </Text>
            </View>
          ) : selectedPatch ? (
            <View style={{ gap: 12 }}>
              <Text style={styles.muted}>
                {uiText('Captured patch at {value0}', { value0: current?.headSha.slice(0, 7) })}
              </Text>
              {selectedPatch.patch ? (
                <View style={{ height: 420 }}>
                  <DiffView
                    path={selectedPatch.path}
                    patch={pullFilePatch({ patch: selectedPatch.patch, status: 'modified' })}
                  />
                </View>
              ) : (
                <Text style={styles.muted}>{uiText('This patch was not supplied.')}</Text>
              )}
            </View>
          ) : (
            <View style={{ gap: 14 }}>
              <Text style={styles.muted}>
                {uiText(
                  'Review PR patches and available Git snapshots, then check proposed findings. No tests run.',
                )}
              </Text>
              <Action
                secondary
                label={
                  agent
                    ? uiText('Reviewer · {value0}', {
                        value0: agent.model || harnessNames[agent.provider],
                      })
                    : uiText('Choose reviewer')
                }
                onPress={() => setSettings(!settings)}
              />
              {(settings || !agent?.model) && (
                <View style={{ gap: 10 }}>
                  <Choice
                    label={uiText('Reviewer provider')}
                    value={agent?.id.startsWith('saved:') ? agent.id : (agent?.provider ?? '')}
                    items={[
                      { id: '', name: uiText('Choose a provider') },
                      ...providerSchema.literals
                        .filter((provider) => supportsUtilities(provider) && provider !== 'acp')
                        .map((provider) => ({ id: provider, name: harnessNames[provider] })),
                      ...agents
                        .filter((item) => supportsUtilities(item.provider))
                        .map((item) => ({ id: `saved:${item.id}`, name: item.name })),
                    ]}
                    onChange={(value) => {
                      const saved = agents.find((item) => `saved:${item.id}` === value)
                      if (saved) setAgent({ ...saved, id: `saved:${saved.id}` })
                      else {
                        const provider = providerSchema.literals.find((item) => item === value)
                        if (provider)
                          setAgent({
                            ...defaultTaskHarness(provider),
                            id: 'pr-review',
                            name: harnessNames[provider],
                          })
                      }
                    }}
                  />
                  {agent && (
                    <ModelSettings
                      agent={agent}
                      onChange={setAgent}
                      serviceTier={false}
                      disabled={!!blocked}
                    />
                  )}
                </View>
              )}
              {!agent?.model && (
                <Text style={styles.muted}>{uiText('Choose a reviewer model to start.')}</Text>
              )}
              <Action
                secondary={!!current && !stale}
                label={
                  stale
                    ? uiText('Review latest revision')
                    : current
                      ? uiText('Review again')
                      : uiText('Start review')
                }
                disabled={!!blocked || !agent?.model}
                onPress={() => start()}
              />
              {current && (
                <>
                  <Choice
                    label={uiText('Review history')}
                    value={current.id}
                    items={
                      review.report?.reviews.map((pass) => ({
                        id: pass.id,
                        name: `${pass.headSha.slice(0, 7)} · ${pass.status} · ${new Date(pass.createdAt).toLocaleString()}`,
                      })) ?? []
                    }
                    onChange={review.select}
                  />
                  <Text style={[styles.muted, { fontSize: 12 }]}>
                    {current.selection.model} · {current.baseSha.slice(0, 7)} →{' '}
                    {current.headSha.slice(0, 7)}
                  </Text>
                  {stale && (
                    <Text accessibilityRole="alert" style={styles.muted}>
                      {uiText(
                        'This PR has new changes. Your report and draft are kept. Review the latest revision before publishing.',
                      )}
                    </Text>
                  )}
                  <Text style={styles.text}>
                    {current.summary ||
                      current.error ||
                      uiText('Review {value0}.', { value0: current.status })}
                  </Text>
                  {current.status === 'running' && (
                    <View style={{ gap: 8 }}>
                      {current.analysis && (
                        <Text accessibilityLiveRegion="polite" style={styles.muted}>
                          {uiText('{value0} · Batch {value1} of {value2}', {
                            value0:
                              current.analysis.phase === 'checking'
                                ? uiText('Checking findings')
                                : uiText('Reviewing evidence'),
                            value1:
                              current.analysis.activeBatch ??
                              Math.min(
                                current.analysis.completedBatches + 1,
                                current.analysis.batches,
                              ),
                            value2: current.analysis.batches,
                          })}
                        </Text>
                      )}
                      <Action
                        secondary
                        label={uiText('Cancel review')}
                        onPress={() => {
                          void review.command('stop', { reviewId: current.id })
                        }}
                      />
                    </View>
                  )}
                  <Text style={[styles.muted, { fontSize: 12 }]}>
                    {uiText('{value0} of {value1} file patches supplied in this pass.', {
                      value0: supplied,
                      value1: current.coverage.length + current.missingFiles,
                    })}
                  </Text>
                  <Choice
                    label={uiText('File coverage and captured patches')}
                    value={patch ?? ''}
                    items={[
                      { id: '', name: uiText('Inspect coverage') },
                      ...current.coverage.map((file) => ({
                        id: file.path,
                        name: `${file.path} · ${uiText(pullReviewCoverageLabels[file.state])}`,
                      })),
                    ]}
                    onChange={(path) => setPatch(path || undefined)}
                  />
                  {current.missingFiles > 0 && (
                    <Text style={styles.muted}>
                      {uiText('{value0} files were not returned by the forge.', {
                        value0: current.missingFiles,
                      })}
                    </Text>
                  )}
                  {!stale &&
                    current.status === 'completed' &&
                    current.coverage.some(
                      (file) => file.state === 'budget' || file.state === 'failed',
                    ) && (
                      <Action
                        secondary
                        label={uiText('Review remaining files')}
                        disabled={!!blocked || !agent?.model}
                        onPress={() => start(true)}
                      />
                    )}
                  {current.findings.map((finding) => {
                    const dismissed = draft?.dismissed.includes(finding.id)
                    const added = draft?.selected.includes(finding.id)
                    return (
                      <View
                        key={finding.id}
                        style={[styles.card, { gap: 8, opacity: dismissed ? 0.6 : 1 }]}
                      >
                        <Text
                          style={[
                            styles.muted,
                            {
                              fontSize: 11,
                              textTransform: 'uppercase',
                              color: finding.severity === 'high' ? colors.error : colors.muted,
                            },
                          ]}
                        >
                          {finding.severity}
                        </Text>
                        <Text style={[styles.text, { fontWeight: '600' }]}>{finding.title}</Text>
                        <Action
                          secondary
                          label={`${finding.path}${finding.anchored ? `:${finding.line} · ${finding.side}` : uiText(' · location not verified')}`}
                          onPress={() => setPatch(finding.path)}
                        />
                        <Text style={styles.text}>{finding.trigger}</Text>
                        <Text style={styles.text}>{finding.impact}</Text>
                        <Text style={styles.muted}>{finding.suggestion}</Text>
                        {finding.evidence && (
                          <>
                            <Action
                              secondary
                              label={
                                evidence === finding.id
                                  ? uiText('Hide evidence')
                                  : uiText('Show evidence and finding check')
                              }
                              onPress={() =>
                                setEvidence(evidence === finding.id ? undefined : finding.id)
                              }
                            />
                            {evidence === finding.id && (
                              <View style={{ gap: 8 }}>
                                <Text selectable style={styles.text}>
                                  {finding.evidence}
                                </Text>
                                <Text style={styles.muted}>{finding.verification}</Text>
                                <Text style={styles.muted}>
                                  {uiText(
                                    'Model confidence: {value0}/10. This is not proof of correctness.',
                                    { value0: finding.confidence },
                                  )}
                                </Text>
                              </View>
                            )}
                          </>
                        )}
                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
                          <Action
                            variant="outline"
                            label={added ? uiText('Remove from draft') : uiText('Add to draft')}
                            disabled={!editable || (!!dismissed && !added)}
                            onPress={() => review.add(finding)}
                          />
                          <Action
                            secondary
                            label={
                              dismissed ? uiText('Restore finding') : uiText('Dismiss finding')
                            }
                            disabled={!editable}
                            onPress={() => {
                              if (!dismissed && added) review.add(finding)
                              review.edit({
                                dismissed: dismissed
                                  ? draft!.dismissed.filter((id) => id !== finding.id)
                                  : [...draft!.dismissed, finding.id],
                              })
                            }}
                          />
                        </View>
                        <Action
                          secondary
                          label={uiText('Check in repository')}
                          disabled={stale}
                          onPress={() => {
                            setOpen(false)
                            onAsk(finding)
                          }}
                        />
                      </View>
                    )
                  })}
                  {current.status === 'completed' && !current.findings.length && (
                    <Text style={styles.muted}>
                      {uiText(
                        'No supported bug findings in this pass. Inspect coverage before deciding.',
                      )}
                    </Text>
                  )}
                  {current.notVerified.map((limit, index) => (
                    <Text key={index} style={[styles.muted, { fontSize: 12 }]}>
                      {limit}
                    </Text>
                  ))}
                  {current.analysis && (
                    <View style={{ gap: 8 }}>
                      <Text style={styles.muted}>
                        {uiText(
                          '{value0} of {value1} batches completed · {value2} snapshot files · {value3} findings filtered',
                          {
                            value0: current.analysis.completedBatches,
                            value1: current.analysis.batches,
                            value2: current.analysis.contextFiles.length,
                            value3: current.analysis.rejectedFindings,
                          },
                        )}
                      </Text>
                      {!!current.analysis.contextFiles.length && (
                        <Choice
                          label={uiText('Snapshot context')}
                          value={contextPath ?? ''}
                          items={[
                            { id: '', name: uiText('Inspect captured context') },
                            ...current.analysis.contextFiles.map((file) => ({
                              id: file.ref + file.path,
                              name: `${file.path} · ${file.ref.slice(0, 7)}`,
                            })),
                          ]}
                          onChange={(path) => setContextPath(path || undefined)}
                        />
                      )}
                    </View>
                  )}
                  {draft && current.status === 'completed' && (
                    <View
                      style={{
                        gap: 12,
                        borderTopWidth: 1,
                        borderColor: colors.border,
                        paddingTop: 16,
                      }}
                    >
                      <Field
                        label={uiText('Your review draft')}
                        multiline
                        maxLength={50000}
                        value={draft.body}
                        editable={editable}
                        onChangeText={(body) => review.edit({ body })}
                      />
                      {!draft.body.trim() &&
                        review.report?.reviews
                          .filter(
                            (pass) =>
                              pass.createdAt < current.createdAt &&
                              !pass.publication &&
                              pass.draft.body.trim(),
                          )
                          .slice(0, 1)
                          .map((pass) => (
                            <Action
                              key={pass.id}
                              secondary
                              label={uiText('Copy draft from the earlier pass')}
                              onPress={() => review.copyDraft(pass)}
                            />
                          ))}
                      <Text
                        accessibilityLiveRegion="polite"
                        style={[styles.muted, { fontSize: 12 }]}
                      >
                        {review.dirty ? uiText('Unsaved changes') : uiText('Saved on computer')}
                      </Text>
                      <Choice
                        label={uiText('Review decision')}
                        value={draft.event}
                        disabled={!editable}
                        items={[
                          { id: 'comment', name: uiText('Comment') },
                          { id: 'request-changes', name: uiText('Request changes') },
                        ].filter(
                          (item) =>
                            !detail.capabilities ||
                            detail.capabilities.reviewDecisions.some((event) => event === item.id),
                        )}
                        onChange={(event) => {
                          if (event === 'comment' || event === 'request-changes')
                            review.edit({ event })
                        }}
                      />
                      {current.publication && (
                        <>
                          <Text style={styles.muted}>
                            {current.publication.status === 'published'
                              ? current.publication.pendingReviewDecision
                                ? uiText(
                                    'Review text posted. The review decision is not confirmed.',
                                  )
                                : uiText('Review published.')
                              : uiText(
                                  'Publication outcome unknown. No second review will be posted.',
                                )}
                          </Text>
                          {current.publication.notice && (
                            <Text style={styles.muted}>{current.publication.notice}</Text>
                          )}
                          {current.publication.error && (
                            <Text style={styles.error}>{current.publication.error}</Text>
                          )}
                          {current.publication.url && (
                            <Action
                              secondary
                              label={uiText('Open review')}
                              onPress={() => {
                                void Linking.openURL(current.publication!.url!).catch(
                                  (error: unknown) => setLinkError(String(error)),
                                )
                              }}
                            />
                          )}
                          {current.publication.status !== 'published' && (
                            <Action
                              secondary
                              label={uiText('Check publication')}
                              onPress={() => {
                                void review.command('publish', {
                                  reviewId: current.id,
                                  version: current.version,
                                  requestId: current.publication!.requestId,
                                  body: current.publication!.body,
                                })
                              }}
                            />
                          )}
                        </>
                      )}
                    </View>
                  )}
                </>
              )}
            </View>
          )}
        </Sheet>
      )}
    </>
  )
}
