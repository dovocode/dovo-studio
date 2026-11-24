import { lazy, Suspense, useEffect } from 'react'
import { useStudioHost } from '@dovo/studio-core'
import { recordClientError } from '@dovo/protocol'
import { closeReportProblem, openReportProblem, useReportProblemOpen } from './open-state'

const ReportProblemDialog = lazy(() =>
  import('./report-problem-dialog').then((module) => ({ default: module.ReportProblemDialog })),
)

/** Records this window's uncaught errors and opens the local or runtime report. */
export function ReportProblem() {
  const { registerCommand } = useStudioHost()
  useEffect(
    () =>
      registerCommand({
        id: 'studio.report-problem',
        title: 'Report a problem…',
        aliases: ['bug', 'issue', 'feedback', 'triage', 'diagnostics', 'help'],
        run: openReportProblem,
      }),
    [registerCommand],
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
