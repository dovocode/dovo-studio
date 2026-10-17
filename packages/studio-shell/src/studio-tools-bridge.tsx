import { useEffect } from 'react'
import { useWorkspace } from '@dovo/studio-core'
import { decode, randomUUID, studioUIPollResultSchema } from '@dovo/protocol'
import { executeStudioUI } from './studio-tools-ui'

/** Opt-in bridge to this already paired desktop/web client. Native mobile uses Device Hub. */
export function StudioToolsBridge() {
  const { connection, connected, snapshot } = useWorkspace()
  const enabled = snapshot?.studioTools?.ui ?? false
  useEffect(() => {
    if (!enabled || !connected || !connection) return
    const hostname = new URL(connection.address).hostname
    if (hostname !== 'localhost' && hostname !== '[::1]' && !hostname.startsWith('127.')) return
    const controller = new AbortController()
    const sessionId = randomUUID()
    const results = new Map<string, unknown>()
    let result: { id: string; value: unknown } | undefined
    const run = async () => {
      while (!controller.signal.aborted) {
        try {
          const response = await fetch(
            connection.address.replace(/\/$/, '') + '/api/studio/session',
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${connection.token}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                sessionId,
                label: `${document.title} (${location.host})`,
                result,
              }),
              signal: AbortSignal.any([controller.signal, AbortSignal.timeout(25000)]),
            },
          )
          if (!response.ok) throw new Error(`Studio bridge: HTTP ${response.status}`)
          const { job } = decode(studioUIPollResultSchema, await response.json())
          result = undefined
          if (!job) continue
          if (!results.has(job.id)) {
            try {
              results.set(job.id, executeStudioUI(document, job.command))
            } catch (error) {
              results.set(job.id, { error: error instanceof Error ? error.message : String(error) })
            }
            if (results.size > 100) {
              const oldest = results.keys().next().value
              if (oldest) results.delete(oldest)
            }
          }
          result = { id: job.id, value: results.get(job.id) }
        } catch (error) {
          if (controller.signal.aborted) return
          console.warn('Studio Tools bridge disconnected', error)
          await new Promise<void>((resolve) => {
            const timer = setTimeout(done, 3000)
            function done() {
              clearTimeout(timer)
              controller.signal.removeEventListener('abort', done)
              resolve()
            }
            controller.signal.addEventListener('abort', done, { once: true })
          })
        }
      }
    }
    void run()
    return () => controller.abort()
  }, [connection, connected, enabled])
  return null
}
