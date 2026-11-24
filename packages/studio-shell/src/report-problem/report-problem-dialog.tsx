import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useStudioHost, useWorkspace, WorkspaceScope } from '@dovo/studio-core'
import { copyTextToClipboard } from '@dovo/studio-ui/clipboard'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  FormField,
  permissionPolicyUIIssue,
} from '@dovo/studio-ui'
import {
  createLauncherTask,
  defaultProblemReportInclude,
  launcherDefaultAgent,
  localProblemDiagnostics,
  problemReportPreviewSchema,
  problemReportRequest,
  problemReportStart,
  problemReportTargets,
  problemReportTitle,
  randomUUID,
  recentClientErrors,
  runtimeComputerName,
  threadStartResultSchema,
  type LauncherAgent,
  type ProblemReportClient,
  type ProblemReportForm,
  type ProblemReportPreview,
  type ProblemReportRequest,
  type ProblemReportStart,
  type RuntimeProfile,
} from '@dovo/protocol'
import { TaskLauncherControls } from '../task-launcher-controls'
import { ReportProblemFields, ReportProblemPreviewView } from './report-problem-view'

type Reviewed = { runtimeId: string; request: ProblemReportRequest; preview: ProblemReportPreview }
type Attempt = { profile: RuntimeProfile; body: ProblemReportStart }

declare const __DOVO_RENDERER_BUILD__: { version: string; commit?: string } | undefined

function clientInfo(appInfo: ReturnType<typeof useStudioHost>['appInfo']): ProblemReportClient {
  const build = typeof __DOVO_RENDERER_BUILD__ === 'undefined' ? undefined : __DOVO_RENDERER_BUILD__
  const viewer = appInfo?.viewer
  const platform = viewer
    ? `${viewer.platform} ${viewer.architecture}`
    : typeof navigator === 'undefined'
      ? undefined
      : navigator.userAgent
  return {
    surface: appInfo ? 'desktop' : 'web',
    ...(appInfo ? { appVersion: appInfo.version, channel: appInfo.channel } : {}),
    ...(!appInfo && build ? { appVersion: build.version } : {}),
    ...(build?.commit ? { commit: build.commit } : {}),
    ...(platform ? { platform: platform.slice(0, 128) } : {}),
  }
}

export function ReportProblemDialog({ onClose }: { onClose: () => void }) {
  const { runtimes, activeRuntimeId, readRuntime, refreshRuntime, storageError, syncError } =
    useWorkspace()
  const { appInfo, openThread } = useStudioHost()
  const targets = useMemo(() => problemReportTargets(runtimes), [runtimes])
  const [runtimeId, setRuntimeId] = useState(
    () =>
      targets.find((target) => target.available && target.profile.id === activeRuntimeId)?.profile
        .id ??
      targets.find((target) => target.available)?.profile.id ??
      '',
  )
  const available = targets.some((entry) => entry.available)
  const target =
    targets.find((entry) => entry.profile.id === runtimeId) ??
    targets.find((entry) => entry.available && entry.profile.id === activeRuntimeId) ??
    targets.find((entry) => entry.available)
  const [form, setForm] = useState<ProblemReportForm>({
    description: '',
    expected: '',
    include: defaultProblemReportInclude,
  })
  const [selection, setSelection] = useState<LauncherAgent | null>(null)
  const manualSelection = useRef(false)
  const [reviewed, setReviewed] = useState<Reviewed | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [showLocal, setShowLocal] = useState(false)
  const [copyStatus, setCopyStatus] = useState('')
  const attempt = useRef<Attempt | null>(null)
  const errors = useMemo(() => recentClientErrors(), [])
  const local = !reviewed && !busy && (showLocal || !available)
  const diagnostics = local
    ? localProblemDiagnostics(
        clientInfo(appInfo),
        {
          saved: runtimes.length,
          connected: runtimes.filter((entry) => entry.connected).length,
          error: storageError || syncError,
        },
        errors,
      )
    : ''
  // The default agent follows the chosen computer until the person picks another one.
  const scratch = target?.scratch
  const snapshot = target?.snapshot
  useEffect(() => {
    if (manualSelection.current) return
    setSelection(snapshot && scratch ? launcherDefaultAgent(snapshot, scratch) : null)
  }, [snapshot, scratch])
  const selectionIssue = selection?.harness
    ? permissionPolicyUIIssue(selection.harness, snapshot?.permissionPolicySupported === true)
    : undefined
  const locked = busy || !!attempt.current

  const preview = async () => {
    if (!target?.available || busy) return
    const request = problemReportRequest(
      {
        ...form,
        include: {
          ...form.include,
          clientTimeline:
            form.include.clientTimeline && target.snapshot?.problemReportTimelineSupported === true,
        },
      },
      clientInfo(appInfo),
      errors,
    )
    if (!request.description) return
    setBusy(true)
    setError('')
    try {
      const result = await readRuntime(
        target.profile,
        '/api/problem-reports/preview',
        request,
        problemReportPreviewSchema,
      )
      setReviewed({ runtimeId: target.profile.id, request, preview: result })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const start = async () => {
    if (!reviewed || busy || selectionIssue) return
    setBusy(true)
    setError('')
    try {
      // Keep the thread and message IDs across retries, so a lost response cannot start twice.
      if (!attempt.current) {
        if (!target?.snapshot || !target.scratch || !selection)
          throw new Error('Choose a connected computer and an agent.')
        const title = problemReportTitle(reviewed.request.description)
        attempt.current = {
          profile: target.profile,
          body: problemReportStart(
            reviewed.request,
            reviewed.preview,
            {
              ...createLauncherTask(
                target.snapshot,
                target.scratch,
                selection,
                title,
                randomUUID(),
              ),
              harnessCustomized: manualSelection.current || undefined,
            },
            randomUUID(),
          ),
        }
      }
      const current = attempt.current
      await readRuntime(
        current.profile,
        '/api/problem-reports/start',
        current.body,
        threadStartResultSchema,
      )
      void refreshRuntime(current.profile).catch((cause: unknown) =>
        console.error('Could not refresh after starting a problem report:', cause),
      )
      openThread?.({
        runtimeId: current.profile.id,
        threadId: current.body.createTask.id,
        title: current.body.createTask.title,
      })
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const selectClass =
    'h-8 w-full appearance-none rounded-md border border-input bg-transparent px-2 pr-7 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50'
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <DialogContent className="max-h-[calc(100dvh-var(--studio-window-top-inset,0px)-24px)] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Report a problem</DialogTitle>
          <DialogDescription>
            {local
              ? 'Preview app diagnostics on this device. Triage requires a connected computer that supports problem reports.'
              : reviewed
                ? 'Check what Dovo will send. Starting creates a new thread without a project.'
                : 'An agent on your computer reads the diagnostics and the Dovo source for your version, then drafts an issue for you to review. Nothing is filed for you.'}
          </DialogDescription>
        </DialogHeader>
        {local ? (
          <pre
            aria-label="Local diagnostics"
            className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md border p-3 text-xs"
          >
            {diagnostics}
          </pre>
        ) : reviewed ? (
          <ReportProblemPreviewView preview={reviewed.preview} />
        ) : (
          <ReportProblemFields
            form={form}
            onChange={setForm}
            disabled={locked}
            clientErrors={errors.length}
            timelineSupported={snapshot?.problemReportTimelineSupported === true}
          >
            <FormField label="Computer">
              <span className="relative">
                <select
                  aria-label="Computer"
                  className={selectClass}
                  value={target?.profile.id ?? ''}
                  disabled={locked}
                  onChange={(event) => {
                    manualSelection.current = false
                    setRuntimeId(event.target.value)
                  }}
                >
                  {!available && (
                    <option value="">No connected computer supports problem reports</option>
                  )}
                  {targets.map((entry) => (
                    <option
                      key={entry.profile.id}
                      value={entry.profile.id}
                      disabled={!entry.available}
                    >
                      {runtimeComputerName({ profile: entry.profile, snapshot: entry.snapshot })}
                      {entry.available ? '' : entry.supported ? ' (offline)' : ' (update required)'}
                    </option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute top-2.5 right-2 size-3" />
              </span>
            </FormField>
            {target?.available && target.scratch && selection && (
              <div className="grid gap-2 text-xs font-medium text-muted-foreground">
                Agent that runs the triage
                <div className="flex flex-wrap items-center gap-1 rounded-md border border-border p-1">
                  <WorkspaceScope key={target.profile.id} profile={target.profile}>
                    <TaskLauncherControls
                      repository={target.scratch}
                      selection={selection}
                      disabled={locked}
                      onChange={(next) => {
                        manualSelection.current = true
                        setSelection(next)
                      }}
                    />
                  </WorkspaceScope>
                </div>
              </div>
            )}
          </ReportProblemFields>
        )}
        {local && copyStatus && <p role="status">{copyStatus}</p>}
        {!local && (error || selectionIssue) && (
          <p role="alert" className="text-xs text-destructive">
            {error || selectionIssue}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          {local ? (
            <>
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
              {available && (
                <Button variant="outline" onClick={() => setShowLocal(false)}>
                  Back to report
                </Button>
              )}
              <Button
                onClick={() =>
                  void copyTextToClipboard(diagnostics).then(
                    () => setCopyStatus('Diagnostics copied'),
                    () => setCopyStatus('Could not copy diagnostics. Select the text to copy it.'),
                  )
                }
              >
                Copy diagnostics
              </Button>
            </>
          ) : reviewed ? (
            <>
              <Button
                variant="outline"
                disabled={locked}
                onClick={() => {
                  setReviewed(null)
                  setError('')
                }}
              >
                Edit report
              </Button>
              <Button disabled={busy || !!selectionIssue} onClick={() => void start()}>
                {busy ? 'Starting…' : attempt.current ? 'Retry start' : 'Start triage thread'}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" disabled={locked} onClick={() => setShowLocal(true)}>
                Local diagnostics
              </Button>
              <Button variant="outline" disabled={busy} onClick={onClose}>
                Cancel
              </Button>
              <Button
                disabled={busy || !target?.available || !form.description.trim()}
                onClick={() => void preview()}
              >
                {busy ? 'Preparing preview…' : 'Preview'}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
