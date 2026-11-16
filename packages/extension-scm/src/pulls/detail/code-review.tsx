import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { ReviewActivity } from './review-activity'
import { PullPatch } from './patch'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ChevronDown, FileSearch, ShieldCheck } from 'lucide-react'
import { prReviewIllustration } from '@dovo/studio-core/pull-code-review'
import {
  defaultTaskHarness,
  acpHarnessChoiceId,
  acpInstallationHarness,
  modelCatalogSchema,
  providerSchema,
  supportsPullReview,
  MAX_PULL_REVIEWERS,
  MAX_ATTACHMENT_BYTES,
  resolveTitleHarness,
  titleSettingsForHarness,
  pullCodeReviewReportSchema,
  pullCodeReviewBody,
  pullReviewCoverageLabels,
  pullReviewReferences,
  pullReviewDepthSchema,
  pullReviewDepths,
  pullReviewCheckLabels,
  pullReviewerStatusLabels,
  randomUUID,
  type Agent,
  type AgentDiscovery,
  type PullDetail,
  type PullReviewSelection,
  type PullCodeReview,
} from '@dovo/protocol'
import {
  useWorkspace,
  useRuntimeSources,
  WorkspaceRuntimeScope,
  providers,
} from '@dovo/studio-core'
import { usePullReviewSource, usePullCodeReview } from '@dovo/studio-core/pull-code-review'
import {
  Button,
  ModelSettings,
  ChoicePicker,
  Textarea,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@dovo/studio-ui'

function LocalPullCodeReviewPanel({
  repositoryId,
  detail,
  sourceReady = true,
  onAsk,
  onStatus,
  onRefresh,
}: {
  repositoryId: string
  sourceReady?: boolean
  detail: PullDetail
  onAsk: (selection: PullReviewSelection) => void
  onStatus?: (status: { running: boolean; findings: number; stale: boolean }) => void
  onRefresh?: () => void
}) {
  const uiText = useInterfaceText()
  const { workspace, request, connected: online, activeRuntimeId, snapshot } = useWorkspace()
  const connected = online && sourceReady
  const transport = useCallback(
    (path: string, input: unknown) => request(path, input, pullCodeReviewReportSchema),
    [request],
  )
  const target = {
    repositoryId,
    number: detail.pull.number,
    connectionId: detail.pull.connectionId,
    expectedDestination: detail.destination ?? detail.pull.destination ?? '',
  }
  const review = usePullCodeReview({
    target,
    scope: activeRuntimeId ?? '',
    request: transport,
    connected: connected && !!target.expectedDestination,
  })
  const [agent, setAgent] = useState<Agent | null>(null)
  const [additional, setAdditional] = useState<Agent[]>()
  const [imageError, setImageError] = useState('')
  const [imageBusy, setImageBusy] = useState(false)
  const imageInput = useRef<HTMLInputElement>(null)
  const reviewers = [agent, ...(additional ?? [])]
  const setReviewer = (index: number, value: Agent) => {
    if (index === 0) setAgent(value)
    else
      setAdditional((items) => (items ?? []).map((item, at) => (at === index - 1 ? value : item)))
  }
  const [settings, setSettings] = useState(false)
  const [preview, setPreview] = useState<PullCodeReview>()
  const [patch, setPatch] = useState<string>()
  const loadModels = useCallback(
    (input: AgentDiscovery) => request('/api/agents/models', input, modelCatalogSchema),
    [request],
  )
  useEffect(() => {
    if (agent || !review.report?.selection) return
    const selection = review.report.selection
    const saved = resolveTitleHarness(selection, workspace.agents)
    if (saved) setAgent({ ...saved, model: selection.model, reasoning: selection.reasoning })
  }, [review.report?.selection, agent, workspace.agents])
  useEffect(() => {
    if (additional !== undefined || !review.report) return
    setAdditional(
      (review.report.reviewers ?? []).flatMap((selection) => {
        const saved = resolveTitleHarness(selection, workspace.agents)
        return saved ? [{ ...saved, model: selection.model, reasoning: selection.reasoning }] : []
      }),
    )
  }, [additional, review.report, workspace.agents])
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
  const supplied = current?.coverage.filter((file) => file.state === 'supplied').length ?? 0
  const latest = review.report?.reviews[0]
  const latestStale =
    !!latest && (latest.headSha !== detail.pull.headSha || latest.baseSha !== detail.pull.baseSha)
  useEffect(() => {
    onStatus?.({ running: !!running, findings: latest?.findings.length ?? 0, stale: latestStale })
  }, [onStatus, running, latest?.findings.length, latestStale])
  const selectedPatch =
    current?.coverage.find((file) => file.path === patch) ??
    current?.coverage.find((file) => file.state === 'supplied')
  const ready =
    !imageBusy &&
    reviewers.every(
      (reviewer) => reviewer?.model && supportsPullReview(reviewer.provider, review.depth),
    )
  const start = (remaining = false) => {
    if (agent && ready)
      void review.start(
        titleSettingsForHarness(agent),
        detail.pull.headSha,
        detail.pull.baseSha,
        remaining,
        {
          depth: review.depth,
          runChecks: review.depth !== 'quick' && review.runChecks,
          reviewers: (additional ?? []).map(titleSettingsForHarness),
          images: review.images,
        },
      )
    else setSettings(true)
  }
  return (
    <section
      aria-label={uiText('Agent PR review')}
      className="@container/review overflow-hidden rounded-xl border bg-card text-sm"
    >
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <div className="flex items-center gap-2 font-medium">
          <ShieldCheck className="size-4 text-emerald-500" />
          {uiText('Agent review')}
        </div>
        <Button variant="ghost" size="sm" onClick={() => setSettings(!settings)}>
          {reviewers.length > 1
            ? uiText('{value0} reviewers', { value0: reviewers.length })
            : agent?.model || uiText('Choose reviewer')}
          <ChevronDown className="size-3" />
        </Button>
      </div>
      {review.busy && (
        <div className="p-4">
          <ReviewActivity reviewers={reviewers.length} />
        </div>
      )}
      {!current && (
        <div className="flex items-center gap-5 bg-[#17191c] px-5 py-4 text-white">
          <img
            src={prReviewIllustration}
            alt=""
            className="hidden w-40 shrink-0 rounded-lg sm:block"
          />
          <div className="space-y-2">
            <h3 className="font-medium">{uiText('A second look before you review')}</h3>
            <p className="max-w-md text-xs leading-5 text-white/65">
              {uiText(
                'Find concrete bugs in this PR. Read the findings, check the evidence, and choose what to share.',
              )}
            </p>
          </div>
        </div>
      )}
      {(settings || !reviewers.every((reviewer) => reviewer?.model)) && (
        <div className="space-y-3 border-b p-4">
          {reviewers.map((reviewer, index) => (
            <div key={index} className="space-y-3 rounded-lg border p-3">
              <div className="flex items-center justify-between text-xs">
                <span>{uiText('Reviewer {value0}', { value0: index + 1 })}</span>
                {index > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setAdditional((items) => items?.filter((_, at) => at !== index - 1))
                    }
                  >
                    {uiText('Remove')}
                  </Button>
                )}
              </div>
              <label className="block text-xs text-muted-foreground">
                {uiText('Reviewer provider')}
              </label>
              <ChoicePicker
                aria-label={uiText('Reviewer provider')}
                value={
                  reviewer?.id.startsWith('saved:')
                    ? reviewer.id
                    : reviewer?.provider === 'acp' && reviewer.acpInstallationId
                      ? acpHarnessChoiceId(reviewer.acpInstallationId)
                      : (reviewer?.provider ?? '')
                }
                onValueChange={(value) => {
                  const installation = snapshot?.acpInstallations?.find(
                    (item) => acpHarnessChoiceId(item.id) === value,
                  )
                  if (installation) {
                    setReviewer(index, {
                      ...acpInstallationHarness(installation, 'read-only'),
                      id: 'pr-review',
                      name: installation.name,
                    })
                    return
                  }
                  const saved = workspace.agents.find((item) => `saved:${item.id}` === value)
                  if (saved) setReviewer(index, { ...saved, id: `saved:${saved.id}` })
                  else {
                    const provider = providerSchema.literals.find((item) => item === value)
                    if (provider)
                      setReviewer(index, {
                        ...defaultTaskHarness(provider),
                        id: 'pr-review',
                        name: providers[provider].short,
                      })
                  }
                }}
              >
                <option value="" disabled>
                  {uiText('Choose a provider')}
                </option>
                {providerSchema.literals
                  .filter((provider) => provider !== 'acp')
                  .map((provider) => (
                    <option
                      key={provider}
                      value={provider}
                      disabled={!supportsPullReview(provider, review.depth)}
                    >
                      {providers[provider].short}
                      {!supportsPullReview(provider, review.depth)
                        ? ` · ${uiText('Unavailable for this review depth')}`
                        : ''}
                    </option>
                  ))}
                {(snapshot?.acpInstallations ?? []).map((installation) => (
                  <option
                    key={acpHarnessChoiceId(installation.id)}
                    value={acpHarnessChoiceId(installation.id)}
                  >
                    {installation.name} · ACP
                  </option>
                ))}
                {workspace.agents
                  .filter((item) => supportsPullReview(item.provider, review.depth))
                  .map((item) => (
                    <option key={item.id} value={`saved:${item.id}`}>
                      {item.name}
                    </option>
                  ))}
              </ChoicePicker>
              {reviewer && (
                <ModelSettings
                  agent={reviewer}
                  onChange={(value) => setReviewer(index, value)}
                  loadModels={loadModels}
                  connected={connected}
                  modes={false}
                  preferences={snapshot?.defaults?.modelPreferences}
                />
              )}
            </div>
          ))}

          <p className="text-xs text-muted-foreground">
            {uiText(
              'Find concrete bugs in this PR. Read the findings, check the evidence, and choose what to share.',
            )}
          </p>
        </div>
      )}
      <div className="border-b px-4 py-2">
        {' '}
        <Button
          variant="outline"
          size="sm"
          disabled={!!blocked || reviewers.length >= MAX_PULL_REVIEWERS}
          onClick={() =>
            setAdditional((items) => [
              ...(items ?? []),
              { ...defaultTaskHarness('claude'), id: 'pr-review', name: 'Claude' },
            ])
          }
        >
          {uiText('Add reviewer')}
        </Button>
      </div>
      <div className="space-y-3 border-b px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap text-xs">
            {uiText('Review depth')}
            <ChoicePicker
              className="w-36 flex-none"
              aria-label={uiText('Review depth')}
              value={review.depth}
              disabled={!!blocked}
              onValueChange={(value) => {
                const depth = pullReviewDepthSchema.literals.find((item) => item === value)
                if (depth) {
                  review.setDepth(depth)
                  if (depth === 'quick') review.setRunChecks(false)
                }
              }}
            >
              {pullReviewDepthSchema.literals.map((depth) => (
                <option key={depth} value={depth}>
                  {uiText(pullReviewDepths[depth].label)}
                </option>
              ))}
            </ChoicePicker>
          </label>
          <label className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap text-xs">
            <input
              type="checkbox"
              checked={review.depth !== 'quick' && review.runChecks}
              disabled={!!blocked || review.depth === 'quick'}
              onChange={(event) => review.setRunChecks(event.target.checked)}
            />
            {uiText('Run project checks')}
          </label>
        </div>
        <p className="text-xs text-muted-foreground">
          {uiText(pullReviewDepths[review.depth].description)}
        </p>
        {review.runChecks && (
          <p className="text-xs text-muted-foreground">
            {uiText(
              'Installs dependencies and runs project scripts. Use only for code you trust. This runs on your computer without a security sandbox.',
            )}
          </p>
        )}
      </div>
      <div className="space-y-2 border-b px-4 py-3">
        <input
          ref={imageInput}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          multiple
          hidden
          aria-label={uiText('Review images')}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? [])
            event.target.value = ''
            setImageError('')
            setImageBusy(true)
            void Promise.all(
              files.map(async (file) => {
                if (file.size > MAX_ATTACHMENT_BYTES) throw new Error('Use images up to 5 MB each.')
                const data = await new Promise<string>((resolve, reject) => {
                  const reader = new FileReader()
                  reader.onload = () =>
                    typeof reader.result === 'string'
                      ? resolve(reader.result.slice(reader.result.indexOf(',') + 1))
                      : reject(new Error('Could not read image.'))
                  reader.onerror = () => reject(new Error('Could not read image.'))
                  reader.readAsDataURL(file)
                })
                return {
                  name: file.name,
                  data,
                  mime: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].find(
                    (mime): mime is 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif' =>
                      mime === file.type,
                  ),
                }
              }),
            )
              .then(review.addImages)
              .catch((error) =>
                setImageError(error instanceof Error ? error.message : String(error)),
              )
              .finally(() => setImageBusy(false))
          }}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={!!blocked || imageBusy || review.images.length >= 3}
          onClick={() => imageInput.current?.click()}
        >
          {uiText(imageBusy ? 'Loading images…' : 'Add images')}
        </Button>
        <p className="text-xs text-muted-foreground">
          {uiText(
            'Optional screenshots or designs. Each reviewer must support image input. Up to three images.',
          )}
        </p>
        {review.images.map((image, index) => (
          <div key={index} className="flex items-center justify-between gap-2 text-xs">
            <img
              alt={image.name}
              src={`data:${image.mime ?? 'image/png'};base64,${image.data}`}
              className="size-14 shrink-0 rounded border object-contain"
            />
            <span className="min-w-0 flex-1 truncate">{image.name}</span>
            <Button
              size="sm"
              variant="ghost"
              disabled={!!blocked}
              onClick={() => review.setImages(review.images.filter((_, at) => at !== index))}
            >
              {uiText('Remove')}
            </Button>
          </div>
        ))}
        {imageError && (
          <p role="alert" className="text-xs text-destructive">
            {imageError}
          </p>
        )}
      </div>
      {!current && (
        <div className="space-y-2 border-b p-4">
          {!agent?.model && (
            <p className="text-xs text-muted-foreground">
              {uiText('Choose a reviewer model to start.')}
            </p>
          )}
          <Button size="sm" disabled={!!blocked || !ready} onClick={() => start()}>
            {uiText('Review with agent')}
          </Button>
        </div>
      )}
      {!target.expectedDestination && (
        <p role="alert" className="p-4 text-xs text-destructive">
          {uiText('Refresh this PR to verify its account before starting a review.')}
        </p>
      )}
      {review.error && (
        <div role="alert" className="space-y-2 border-b p-4 text-xs text-destructive">
          <p>{review.error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onRefresh?.()
              void review.refresh()
            }}
          >
            {uiText('Refresh report')}
          </Button>
          {review.dirty && (
            <Button variant="outline" size="sm" onClick={() => void review.save()}>
              {uiText('Retry saving draft')}
            </Button>
          )}
        </div>
      )}
      {review.draftConflict && (
        <div role="alert" className="space-y-2 border-b p-4 text-xs">
          <p>{uiText('A saved draft from another client is newer. Your edits are kept.')}</p>
          <details>
            <summary>{uiText('Compare the saved draft')}</summary>
            <pre className="whitespace-pre-wrap">{current?.draft.body}</pre>
          </details>
          <Button size="sm" variant="outline" onClick={review.replaceSavedDraft}>
            {uiText('Save my draft over this version')}
          </Button>
          <Button size="sm" variant="ghost" onClick={review.reloadDraft}>
            {uiText('Use the saved draft')}
          </Button>
        </div>
      )}
      {review.notice && (
        <p role="status" className="border-b p-4 text-xs text-muted-foreground">
          {review.notice}
        </p>
      )}
      {current && (
        <div className="space-y-2 border-b p-4 text-xs">
          <p className="text-muted-foreground">
            {uiText('Review depth')} · {uiText(pullReviewDepths[current.depth ?? 'standard'].label)}
          </p>
          {!!current.checks?.length && (
            <details open={current.status === 'running'}>
              <summary className="cursor-pointer">
                {uiText('Project check results')} ·{' '}
                {current.checks.filter((check) => check.status === 'passed').length}/
                {current.checks.length}
              </summary>
              <p className="py-2 text-muted-foreground">
                {uiText(
                  'Commands ran on this computer at commit {value0}. Results are separate from model findings.',
                  { value0: current.headSha.slice(0, 7) },
                )}
              </p>
              {current.checks.map((check, index) => (
                <details key={index} className="border-t py-2">
                  <summary className="cursor-pointer">
                    {check.command || check.name} · {uiText(pullReviewCheckLabels[check.status])}
                  </summary>
                  <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2">
                    {check.output || uiText('Waiting for command output')}
                  </pre>
                  {check.exitCode !== undefined && (
                    <p>{uiText('Exit code: {value0}', { value0: check.exitCode })}</p>
                  )}
                </details>
              ))}
            </details>
          )}
        </div>
      )}
      {current && (
        <div className="grid min-w-0 @3xl/review:grid-cols-[minmax(0,1fr)_minmax(320px,0.85fr)]">
          <div className="min-w-0 border-b bg-muted/10 @3xl/review:border-b-0 @3xl/review:border-r">
            <div className="flex items-center gap-2 border-b p-3">
              <FileSearch className="size-4 shrink-0 text-muted-foreground" />
              <ChoicePicker
                aria-label={uiText('Captured review file')}
                value={selectedPatch?.path ?? ''}
                onValueChange={setPatch}
              >
                {current.coverage
                  .filter((file) => file.state === 'supplied')
                  .map((file) => (
                    <option key={file.path} value={file.path}>
                      {file.path}
                    </option>
                  ))}
              </ChoicePicker>
            </div>
            <p className="border-b px-4 py-2 text-[11px] text-muted-foreground">
              {uiText('Captured evidence · {value0} · {value1}', {
                value0: current.headSha.slice(0, 7),
                value1: selectedPatch?.path,
              })}
            </p>
            <div className="max-h-[75vh] overflow-auto">
              {selectedPatch?.patch ? (
                <PullPatch
                  key={current.id + selectedPatch.path}
                  file={{
                    path: selectedPatch.path,
                    patch: selectedPatch.patch,
                    status: 'modified',
                    additions: 0,
                    deletions: 0,
                  }}
                  split={false}
                  allowAgent={false}
                  allowInlineComment={false}
                />
              ) : (
                <p className="p-5 text-xs text-muted-foreground">
                  {uiText('No patch available in this pass.')}
                </p>
              )}
            </div>
          </div>
          <div className="min-w-0 space-y-4 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <ChoicePicker
                aria-label={uiText('Review history')}
                value={current.id}
                onValueChange={review.select}
              >
                {review.report?.reviews.map((pass) => (
                  <option key={pass.id} value={pass.id}>
                    {pass.headSha.slice(0, 7)} · {pass.status} ·{' '}
                    {new Date(pass.createdAt).toLocaleString()}
                  </option>
                ))}
              </ChoicePicker>
              <Button
                size="sm"
                variant="outline"
                disabled={!!blocked || !ready}
                onClick={() => start()}
              >
                {stale ? uiText('Review latest revision') : uiText('Review again')}
              </Button>
            </div>
            <div className="space-y-1 text-xs text-muted-foreground">
              {current.reviewerResults?.map((reviewer) => (
                <p key={reviewer.id}>
                  {reviewer.selection.harness?.provider ?? reviewer.selection.agentId} ·{' '}
                  {reviewer.selection.model} · {uiText(pullReviewerStatusLabels[reviewer.status])} ·{' '}
                  {uiText('{value0}/{value1} batches', {
                    value0: reviewer.completedBatches,
                    value1: reviewer.batches,
                  })}
                  {reviewer.error ? ` · ${reviewer.error}` : ''}
                </p>
              ))}
              {current.images?.map((image) => (
                <p key={image.id}>
                  {image.name} · {image.mime}
                </p>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {current.selection.model} · {current.baseSha.slice(0, 7)} →{' '}
              {current.headSha.slice(0, 7)}
            </p>
            {stale && (
              <p
                role="status"
                className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs"
              >
                {uiText(
                  'This PR has new changes. This report and its draft are kept. Review the latest revision before publishing.',
                )}
              </p>
            )}
            {current.status === 'running' ? (
              <div className="space-y-2 py-3">
                <ReviewActivity review={current} />
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void review.command('stop', { reviewId: current.id })}
                >
                  {uiText('Cancel review')}
                </Button>
              </div>
            ) : (
              <p className="leading-6">
                {current.summary ||
                  current.error ||
                  uiText('Review {value0}. Start another pass when ready.', {
                    value0: current.status,
                  })}
              </p>
            )}
            <details className="rounded-lg border p-3 text-xs">
              <summary className="cursor-pointer">
                {uiText('{value0} of {value1} file patches supplied in this pass', {
                  value0: supplied,
                  value1: current.coverage.length + current.missingFiles,
                })}
              </summary>
              <p className="my-2 text-muted-foreground">
                {uiText(
                  'Supplying a patch does not prove the model checked every line. Separate passes can miss issues across files.',
                )}
              </p>
              <ul className="space-y-1">
                {current.coverage.map((file) => (
                  <li key={file.path} className="flex justify-between gap-3">
                    <span className="break-all">{file.path}</span>
                    <span className="shrink-0 text-muted-foreground">
                      {uiText(pullReviewCoverageLabels[file.state])}
                    </span>
                  </li>
                ))}
              </ul>
              {current.missingFiles > 0 && (
                <p>
                  {uiText('{value0} files were not returned by the forge.', {
                    value0: current.missingFiles,
                  })}
                </p>
              )}
            </details>
            {!stale &&
              current.status === 'completed' &&
              current.coverage.some(
                (file) => file.state === 'budget' || file.state === 'failed',
              ) && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!!blocked || !ready}
                  onClick={() => start(true)}
                >
                  {uiText('Review remaining files')}
                </Button>
              )}
            <div className="space-y-3">
              {current.findings.map((finding) => {
                const dismissed = draft?.dismissed.includes(finding.id)
                const added = draft?.selected.includes(finding.id)
                return (
                  <article
                    key={finding.id}
                    className={`rounded-lg border p-4 ${dismissed ? 'opacity-60' : ''}`}
                  >
                    <div className="mb-2 flex items-start gap-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${finding.severity === 'high' ? 'bg-red-500/10 text-red-500' : 'bg-amber-500/10 text-amber-600'}`}
                      >
                        {finding.severity}
                      </span>
                      <h4 className="font-medium">{finding.title}</h4>
                    </div>
                    <button
                      type="button"
                      className="mb-2 break-all text-xs text-muted-foreground underline underline-offset-4"
                      onClick={() => setPatch(finding.path)}
                    >
                      {finding.path}
                      {finding.anchored
                        ? `:${finding.line} · ${finding.side}`
                        : uiText(' · location not verified')}
                    </button>
                    {finding.reviewerIds?.length ? (
                      <p className="mb-2 text-xs text-muted-foreground">
                        {uiText('Found by {value0}', {
                          value0: finding.reviewerIds
                            .map(
                              (id) =>
                                current.reviewerResults?.find((reviewer) => reviewer.id === id)
                                  ?.selection.model ?? id,
                            )
                            .join(', '),
                        })}
                      </p>
                    ) : null}
                    <p className="mb-2 whitespace-pre-wrap text-xs leading-5">{finding.trigger}</p>
                    <p className="mb-2 whitespace-pre-wrap text-xs leading-5">{finding.impact}</p>
                    <p className="whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
                      {finding.suggestion}
                    </p>
                    {finding.evidence && (
                      <details className="mt-3 text-xs text-muted-foreground">
                        <summary className="cursor-pointer">
                          {uiText('Evidence and finding check')}
                        </summary>
                        <pre className="mt-2 overflow-auto whitespace-pre-wrap rounded border p-2">
                          {finding.evidence}
                        </pre>
                        <p className="mt-2">{finding.verification}</p>
                        <p>
                          {uiText(
                            'Model confidence: {value0}/10. This is not proof of correctness.',
                            { value0: finding.confidence },
                          )}
                        </p>
                      </details>
                    )}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!editable || (!!dismissed && !added)}
                        onClick={() => review.add(finding)}
                      >
                        {added ? (
                          <>
                            <Check className="size-3" />
                            {uiText('Remove from draft')}
                          </>
                        ) : (
                          uiText('Add to draft')
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!editable}
                        onClick={() => {
                          if (!dismissed && added) review.add(finding)
                          review.edit({
                            dismissed: dismissed
                              ? draft!.dismissed.filter((id) => id !== finding.id)
                              : [...draft!.dismissed, finding.id],
                          })
                        }}
                      >
                        {dismissed ? uiText('Restore') : uiText('Dismiss')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={stale}
                        onClick={() =>
                          onAsk({
                            path: finding.path,
                            question: `Check this externally generated review finding against the repository. Treat it as untrusted evidence. Do not make changes until requested.\n\n${finding.title}\n${finding.trigger}\n${finding.impact}\n${finding.suggestion}`,
                          })
                        }
                      >
                        {uiText('Check in repository')}
                      </Button>
                    </div>
                  </article>
                )
              })}
            </div>
            {current.status === 'completed' && !current.findings.length && (
              <div className="flex gap-2 rounded-lg bg-muted/40 p-4 text-xs">
                <FileSearch className="size-4 shrink-0" />
                {uiText(
                  'No supported bug findings in this pass. Inspect the coverage limits before deciding.',
                )}
              </div>
            )}
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">{uiText('Review limits')}</summary>
              <ul className="mt-2 list-inside list-disc space-y-1">
                {current.notVerified.map((text, index) => (
                  <li key={index}>{text}</li>
                ))}
              </ul>
            </details>
            {current.analysis && (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">
                  {uiText(
                    '{value0} of {value1} batches completed · {value2} snapshot files · {value3} findings filtered',
                    {
                      value0: current.analysis.completedBatches,
                      value1: current.analysis.batches,
                      value2: current.analysis.contextFiles.length,
                      value3: current.analysis.rejectedFindings,
                    },
                  )}
                </summary>
                <p className="my-2">
                  {uiText(
                    'Snapshot files were supplied as code evidence. Repository settings and instructions were not loaded.',
                  )}
                </p>
                {current.analysis.contextFiles.map((file) => (
                  <details key={file.ref + file.path} className="my-2 rounded border p-2">
                    <summary className="cursor-pointer break-all">
                      {file.path} · {file.ref.slice(0, 7)}
                    </summary>
                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap">
                      {file.text}
                    </pre>
                  </details>
                ))}
              </details>
            )}
            {draft && current.status === 'completed' && (
              <div className="space-y-3 border-t pt-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium">{uiText('Your review draft')}</h4>
                  <span role="status" className="text-xs text-muted-foreground">
                    {review.dirty ? uiText('Unsaved changes') : uiText('Saved on computer')}
                  </span>
                </div>
                <Textarea
                  aria-label={uiText('Review draft')}
                  value={draft.body}
                  onChange={(event) => review.edit({ body: event.target.value })}
                  disabled={!editable}
                  className="min-h-36 text-xs"
                  placeholder={uiText('Add findings above, or write your review.')}
                  maxLength={50000}
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
                      <Button
                        key={pass.id}
                        size="sm"
                        variant="outline"
                        onClick={() => review.copyDraft(pass)}
                      >
                        {uiText('Copy draft from the earlier pass')}
                      </Button>
                    ))}
                <ChoicePicker
                  aria-label={uiText('Review decision')}
                  value={draft.event}
                  disabled={!editable}
                  onValueChange={(event) => {
                    if (event === 'comment' || event === 'request-changes') review.edit({ event })
                  }}
                >
                  <option
                    value="comment"
                    disabled={
                      detail.capabilities &&
                      !detail.capabilities.reviewDecisions.includes('comment')
                    }
                  >
                    {uiText('Comment')}
                  </option>
                  <option
                    value="request-changes"
                    disabled={
                      detail.capabilities &&
                      !detail.capabilities.reviewDecisions.includes('request-changes')
                    }
                  >
                    {uiText('Request changes')}
                  </option>
                </ChoicePicker>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={
                      !connected ||
                      stale ||
                      review.busy ||
                      !draft.body.trim() ||
                      !!current.publication
                    }
                    onClick={async () => {
                      const body = await review.preparePreview()
                      if (body !== undefined) setPreview(body)
                    }}
                  >
                    {review.busy ? uiText('Saving draft…') : uiText('Preview review')}
                  </Button>
                </div>
                {current.publication && (
                  <div role="status" className="space-y-2 text-xs">
                    {current.publication.status === 'published' ? (
                      <p>
                        {current.publication.pendingReviewDecision
                          ? uiText('Review text posted. The review decision is not confirmed.')
                          : uiText('Review published.')}{' '}
                        <a
                          className="underline"
                          href={current.publication.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {uiText('Open review')}
                        </a>
                      </p>
                    ) : (
                      <>
                        <p>
                          {uiText(
                            'The publication outcome is unknown. Check before posting again. {value0}',
                            { value0: current.publication.error },
                          )}
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            void review.command('publish', {
                              reviewId: current.id,
                              version: current.version,
                              requestId: current.publication!.requestId,
                              body: current.publication!.body,
                            })
                          }
                        >
                          {uiText('Check publication')}
                        </Button>
                      </>
                    )}
                    {current.publication.notice && <p>{current.publication.notice}</p>}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
      {preview !== undefined && current && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !review.publishing) setPreview(undefined)
          }}
        >
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
            <DialogTitle>{uiText('Publish your review')}</DialogTitle>
            {(current.id !== preview.id || current.version !== preview.version) && (
              <p role="alert" className="text-xs text-destructive">
                {uiText('The draft changed. Return to the draft and preview it again.')}
              </p>
            )}
            <DialogDescription>
              {preview.account} · {preview.url} · {preview.headSha.slice(0, 7)} ·{' '}
              {preview.draft.event === 'request-changes'
                ? uiText('Request changes')
                : uiText('Comment')}
            </DialogDescription>
            <p className="text-xs text-muted-foreground">
              {uiText('This is the exact Markdown that will be posted under your account.')}
            </p>
            <p className="text-xs text-muted-foreground">
              {uiText('The final HTML comment lets Dovo find this review if the connection drops.')}
            </p>
            {review.error && (
              <p role="alert" className="text-xs text-destructive">
                {review.error}
              </p>
            )}
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-muted/30 p-4 text-xs">
              {pullCodeReviewBody(preview)}
            </pre>
            {pullReviewReferences(pullCodeReviewBody(preview)).length > 0 && (
              <p className="break-all text-xs text-amber-600">
                {uiText('Mentions and references: {value0}', {
                  value0: pullReviewReferences(pullCodeReviewBody(preview)).join(', '),
                })}
              </p>
            )}
            <Button
              variant="outline"
              disabled={review.publishing}
              onClick={() => setPreview(undefined)}
            >
              {uiText('Back to draft')}
            </Button>
            <Button
              disabled={
                !connected ||
                stale ||
                review.dirty ||
                review.publishing ||
                !!current.publication ||
                current.id !== preview.id ||
                current.version !== preview.version
              }
              onClick={async () => {
                const result = await review.command('publish', {
                  reviewId: preview.id,
                  version: preview.version,
                  requestId: randomUUID(),
                  body: pullCodeReviewBody(preview),
                })
                if (result) setPreview(undefined)
              }}
            >
              {review.publishing ? uiText('Publishing…') : uiText('Publish review')}
            </Button>
          </DialogContent>
        </Dialog>
      )}
    </section>
  )
}

type PanelProps = Parameters<typeof LocalPullCodeReviewPanel>[0]

export function PullCodeReviewPanel(props: PanelProps) {
  const uiText = useInterfaceText()
  const { activeRuntimeId } = useWorkspace()
  const computers = useRuntimeSources()
  const [chosen, setChosen] = useState('')
  const runtimeId = chosen || activeRuntimeId || ''
  return (
    <div className="space-y-3">
      {computers.length > 1 && (
        <label className="flex flex-wrap items-center gap-3 text-xs">
          <span className="shrink-0 whitespace-nowrap">{uiText('Review on computer')}</span>
          <ChoicePicker
            className="w-60 max-w-full flex-none"
            aria-label={uiText('Review on computer')}
            value={runtimeId}
            onValueChange={setChosen}
          >
            {computers.map((computer) => (
              <option key={computer.profile.id} value={computer.profile.id}>
                {computer.name}
                {computer.connected ? '' : ` · ${uiText('Offline')}`}
              </option>
            ))}
          </ChoicePicker>
        </label>
      )}
      {runtimeId === activeRuntimeId || !runtimeId ? (
        <LocalPullCodeReviewPanel key={runtimeId} {...props} />
      ) : (
        <WorkspaceRuntimeScope runtimeId={runtimeId}>
          <RemotePullCodeReviewPanel key={runtimeId} {...props} />
        </WorkspaceRuntimeScope>
      )}
    </div>
  )
}

function RemotePullCodeReviewPanel(props: PanelProps) {
  const uiText = useInterfaceText()
  const { workspace, request, connected, activeRuntimeId, connection } = useWorkspace()
  const source = usePullReviewSource({
    detail: props.detail,
    repositories: workspace.repositories,
    request,
    connected,
    scope: JSON.stringify([activeRuntimeId, connection]),
  })
  return (
    <div className="space-y-3">
      {source.candidates.length > 1 && (
        <ChoicePicker
          aria-label={uiText('Project')}
          value={source.repositoryId}
          onValueChange={source.choose}
        >
          <option value="">{uiText('Choose a project')}</option>
          {source.candidates.map((repository) => (
            <option key={repository.id} value={repository.id}>
              {repository.name} · {repository.path}
            </option>
          ))}
        </ChoicePicker>
      )}
      {source.detail && source.error && (
        <p role="alert" className="text-xs text-destructive">
          {source.error}{' '}
          <Button size="sm" variant="outline" onClick={source.refresh}>
            {uiText('Retry')}
          </Button>
        </p>
      )}
      {source.detail ? (
        <LocalPullCodeReviewPanel
          {...props}
          repositoryId={source.repositoryId}
          detail={{
            ...source.detail,
            pull: {
              ...source.detail.pull,
              headSha: props.detail.pull.headSha,
              baseSha: props.detail.pull.baseSha,
            },
          }}
          sourceReady={source.ready}
          onRefresh={source.refresh}
        />
      ) : (
        <div
          role="status"
          className="space-y-2 rounded-xl border p-4 text-xs text-muted-foreground"
        >
          <p>
            {!connected
              ? uiText('Reconnect this computer to review.')
              : (source.error ??
                uiText(
                  source.repositoryId
                    ? 'Loading PR on this computer…'
                    : 'Choose a project on this computer.',
                ))}
          </p>
          {source.error && (
            <Button size="sm" variant="outline" onClick={source.refresh}>
              {uiText('Retry')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
