import { useLayoutEffect, useRef, useState } from 'react'
import { useWorkspace } from '@dovo/studio-core'
import { taskInputVisible, type RuntimeConnection } from '@dovo/protocol'
import {
  createRuntimeClient,
  sealSecureInput,
  secureInputResultSchema,
  type PendingSecureInput,
  type SecureInputReply,
} from '@dovo/protocol/secure-input'

export function TaskSecureInputs({ taskId }: { taskId: string }) {
  const { snapshot, connection, connected } = useWorkspace()
  if (!connection) return null
  return (snapshot?.secureInputs ?? [])
    .filter((input) => taskInputVisible(snapshot?.workspace.tasks ?? [], taskId, input))
    .map((input) => (
      <SecureInputCard
        key={`${input.id}:${input.publicKey}:${connection.address}`}
        input={input}
        connection={connection}
        connected={connected}
      />
    ))
}

export function SecureInputCard({
  input,
  connection,
  connected,
}: {
  input: PendingSecureInput
  connection: RuntimeConnection
  connected: boolean
}) {
  const field = useRef<HTMLInputElement>(null)
  const envelope = useRef<SecureInputReply | null>(null)
  const sending = useRef(false)
  const cancelling = useRef(false)
  const epoch = useRef(0)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [done, setDone] = useState(false)
  useLayoutEffect(() => {
    epoch.current++
    sending.current = false
    cancelling.current = false
    setDone(false)
    setBusy(false)
    setStatus('')
    const clear = () => {
      if (field.current) field.current.value = ''
    }
    clear()
    envelope.current = null
    const hidden = () => {
      if (document.visibilityState !== 'visible') clear()
    }
    document.addEventListener('visibilitychange', hidden)
    window.addEventListener('blur', clear)
    return () => {
      epoch.current++
      clear()
      envelope.current = null
      document.removeEventListener('visibilitychange', hidden)
      window.removeEventListener('blur', clear)
    }
  }, [connection, input.id, input.publicKey])
  const act = async (cancel: boolean) => {
    if (!connected || done || (cancel ? cancelling.current : sending.current)) return
    if (cancel) cancelling.current = true
    // Cancellation supersedes a pending submission, including its late response.
    const attempt = ++epoch.current
    sending.current = true
    setBusy(true)
    setStatus('')
    try {
      const check = !cancel && input.status === 'running' && !envelope.current
      if (!cancel && !check && !envelope.current)
        envelope.current = sealSecureInput(input, field.current?.value ?? '')
      if (field.current) field.current.value = ''
      const result = await createRuntimeClient(connection).request(
        cancel
          ? '/api/secure-input/cancel'
          : check
            ? '/api/secure-input/status'
            : '/api/secure-input/submit',
        cancel || check ? { taskId: input.taskId, id: input.id } : envelope.current,
        secureInputResultSchema,
        { timeoutMs: 70_000 },
      )
      if (attempt !== epoch.current) return
      setStatus(`Secure input ${result.status}.`)
      if (!['running', 'pending'].includes(result.status)) {
        envelope.current = null
        setDone(true)
      }
    } catch {
      if (attempt !== epoch.current) return
      // Transport errors can quote request details. Keep the message fixed.
      if (field.current) field.current.value = ''
      setStatus(
        cancel
          ? 'Cancellation is not confirmed. Reconnect and try again.'
          : envelope.current
            ? 'Delivery is not confirmed. Retry to check the same submission.'
            : input.status === 'running'
              ? 'Status is not available. Reconnect and check again.'
              : 'Enter a private value of at most 8192 UTF-8 bytes.',
      )
    } finally {
      if (attempt === epoch.current) {
        if (cancel) cancelling.current = false
        sending.current = false
        setBusy(false)
      }
    }
  }
  const destination = input.destination
  const pending = input.status === 'pending'
  return (
    <section
      className="mx-5 mb-3 space-y-3 rounded-xl border border-border bg-card p-4"
      data-private="true"
      data-studio-human-only="true"
    >
      <h3 className="text-sm font-semibold">Secure input · {input.title}</h3>
      <p className="text-sm">{input.prompt}</p>
      <p className="text-xs text-muted-foreground">
        Only this runtime receives the value. The agent receives status only. Input is not saved.
      </p>
      <div className="break-all rounded-lg bg-muted p-3 text-xs">
        {destination.kind === 'command' ? (
          <>
            <p>
              Run:{' '}
              <code>
                {[destination.command, ...destination.args]
                  .map((arg) => JSON.stringify(arg))
                  .join(' ')}
              </code>
            </p>
            <p>Folder: {input.directory}</p>
            <p>
              Use stdin{destination.appendNewline ? ' with a trailing newline' : ' as entered'}.
              Output is discarded. Trust this command before you submit.
            </p>
          </>
        ) : (
          <p>Complete the active sign-in for ACP installation: {destination.installationId}</p>
        )}
        <p>Expires: {new Date(input.expiresAt).toLocaleTimeString()}</p>
      </div>
      <label className="block space-y-1 text-sm">
        Private value
        <input
          ref={field}
          type="password"
          autoComplete="off"
          spellCheck={false}
          autoCorrect="off"
          data-lpignore="true"
          data-1p-ignore="true"
          name="secure-input"
          aria-label="Private value"
          disabled={!connected || busy || done || !pending || !!envelope.current}
          onCopy={(event) => event.preventDefault()}
          onCut={(event) => event.preventDefault()}
          className="w-full rounded-lg border bg-background px-3 py-2"
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              event.stopPropagation()
              void act(false)
            }
          }}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
          disabled={!connected || busy || done}
          onClick={() => void act(false)}
        >
          {busy
            ? 'Sending…'
            : envelope.current || input.status === 'running'
              ? 'Check submission'
              : destination.kind === 'command'
                ? 'Submit and run privately'
                : 'Submit callback privately'}
        </button>
        <button
          type="button"
          className="rounded-lg border px-3 py-2 text-sm"
          disabled={!connected || done}
          onClick={() => void act(true)}
        >
          Cancel secure input
        </button>
      </div>
      {!connected && (
        <p role="status" className="text-xs">
          Reconnect to submit. Private input is never queued.
        </p>
      )}
      {!!status && (
        <p role="status" className="text-xs">
          {status}
        </p>
      )}
    </section>
  )
}
