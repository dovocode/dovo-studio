import { lazy, Suspense, useEffect } from 'react'
import { useStudioHost, useWorkspace } from '@dovo/studio-core'
import { recordClientError } from '@dovo/protocol'
import { closeReportProblem, openReportProblem, useReportProblemOpen } from './open-state'

const ReportProblemDialog = lazy(() =>
  import('./report-problem-dialog').then((module) => ({ default: module.ReportProblemDialog })),
)

/** Registers "Report a problem…" while a connected computer supports it, records this
 * window's uncaught errors for the report and renders the dialog when opened. */
export function ReportProblem() {
  const { runtimes } = useWorkspace()
  const { registerCommand } = useStudioHost()
  const supported = runtimes.some((entry) => entry.snapshot?.problemReportsSupported === true)
  useEffect(
    () =>
      supported
        ? registerCommand({
            id: 'studio.report-problem',
            title: 'Report a problem…',
            aliases: ['bug', 'issue', 'feedback', 'triage', 'diagnostics', 'help'],
            run: openReportProblem,
          })
        : undefined,
    [supported, registerCommand],
  )
  useEffect(() => {
    const error = (event: ErrorEvent) => recordClientError(event.error ?? event.message, 'window')
    const rejection = (event: PromiseRejectionEvent) =>
      recordClientError(event.reason, 'unhandled rejection')
    window.addEventListener('error', error)
    window.addEventListener('unhandledrejection', rejection)
    return () => {
      window.removeEventListener('error', error)
      window.removeEventListener('unhandledrejection', rejection)
    }
  }, [])
  const open = useReportProblemOpen()
  return open ? (
    <Suspense fallback={null}>
      <ReportProblemDialog onClose={closeReportProblem} />
    </Suspense>
  ) : null
}
