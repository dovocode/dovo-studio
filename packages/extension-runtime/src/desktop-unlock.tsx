import './novnc-types'
import { useEffect, useRef, useState } from 'react'
import type RFB from '@novnc/novnc'
import { Button } from '@dovo/web-ui/button'
import { Input } from '@dovo/web-ui/input'

/** Native Screen Sharing authentication, embedded only for the lifetime of a locked session. */
export function DesktopUnlock({
  id,
  onClose,
  unlockUrl,
  username,
}: {
  id: string
  onClose: () => void
  unlockUrl: (id: string) => Promise<string>
  username?: string
}) {
  const currentUnlockUrl = useRef(unlockUrl)
  currentUnlockUrl.current = unlockUrl
  const target = useRef<HTMLDivElement>(null)
  const client = useRef<RFB | null>(null)
  const deadline = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [attempt, setAttempt] = useState(0)
  const [credentials, setCredentials] = useState(false)
  const [authenticating, setAuthenticating] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!target.current) return
    setError('')
    setCredentials(false)
    setAuthenticating(false)
    setReady(false)
    if (!globalThis.crypto?.subtle) {
      setError(
        'Open Studio’s desktop app or a secure viewer page to authenticate with macOS. The computer’s LAN/VPN address can still use HTTP.',
      )
      return
    }
    const element = target.current
    let disposed = false
    let socket: WebSocket | undefined
    let rfb: RFB | undefined
    let failed = false
    deadline.current = setTimeout(() => {
      if (disposed) return
      failed = true
      setError(
        'Screen Sharing did not finish connecting. Check this Mac’s Screen Sharing access, then retry.',
      )
      rfb?.disconnect()
      socket?.close()
    }, 15000)
    void (async () => {
      const { default: RFB } = await import('@novnc/novnc')
      if (disposed || failed) return
      const url = await currentUnlockUrl.current(id)
      if (disposed || failed) return
      socket = new WebSocket(url)
      socket.addEventListener('close', (event) => {
        if (!disposed && event.code !== 1000 && event.reason && !failed) {
          failed = true
          setError((previous) => previous || event.reason)
        }
      })
      rfb = new RFB(element, socket, { shared: true })
      client.current = rfb
      rfb.scaleViewport = true
      rfb.resizeSession = false
      rfb.clipViewport = false
      rfb.addEventListener('credentialsrequired', () => {
        clearTimeout(deadline.current)
        if (!disposed) {
          setAuthenticating(false)
          setCredentials(true)
        }
      })
      rfb.addEventListener('connect', () => {
        if (disposed) return
        clearTimeout(deadline.current)
        setCredentials(false)
        setAuthenticating(false)
        setReady(true)
        rfb?.focus()
      })
      rfb.addEventListener('securityfailure', (event) => {
        if (disposed) return
        clearTimeout(deadline.current)
        failed = true
        setCredentials(false)
        setAuthenticating(false)
        const reason =
          typeof event.detail.reason === 'string' ? event.detail.reason.slice(0, 500) : ''
        setError(
          `macOS refused authentication.${reason ? ` ${reason}.` : ''} Use this Mac’s account short name and login password, and check its Screen Sharing access.`,
        )
      })
      rfb.addEventListener('disconnect', () => {
        if (disposed) return
        clearTimeout(deadline.current)
        client.current = null
        setReady(false)
        setCredentials(false)
        setAuthenticating(false)
        if (!failed)
          setError(
            (previous) =>
              previous ||
              'Screen Sharing disconnected. Retry the connection or close this panel to check the desktop.',
          )
      })
    })().catch((cause: unknown) => {
      failed = true
      clearTimeout(deadline.current)
      rfb?.disconnect()
      socket?.close()
      if (!disposed) {
        client.current = null
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    })
    return () => {
      disposed = true
      clearTimeout(deadline.current)
      client.current = null
      rfb?.disconnect()
      socket?.close()
    }
  }, [id, attempt])
  return (
    <section aria-label="Unlock desktop" className="space-y-3 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">Unlock with macOS Screen Sharing</h3>
          <p className="text-xs text-muted-foreground">
            Sign in with a macOS account allowed to use Screen Sharing on this Mac. Studio does not
            save your password.
          </p>
        </div>
        <Button variant="outline" onClick={onClose}>
          Close unlock
        </Button>
      </div>
      {credentials && !error && (
        <form
          autoComplete="off"
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            const form = event.currentTarget
            const values = new FormData(form)
            const username = values.get('username')
            const password = values.get('password')
            if (typeof username !== 'string' || typeof password !== 'string') return
            client.current?.sendCredentials({ username, password, target: '' })
            form.reset()
            setCredentials(false)
            setAuthenticating(true)
            clearTimeout(deadline.current)
            deadline.current = setTimeout(() => {
              setError(
                'macOS did not complete authentication. Check the account’s Screen Sharing access and retry.',
              )
              client.current?.disconnect()
            }, 15000)
          }}
        >
          <label className="space-y-1 text-xs">
            <span>Mac username</span>
            <Input
              name="username"
              defaultValue={username ?? ''}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              maxLength={63}
            />
          </label>
          <label className="space-y-1 text-xs">
            <span>Mac password</span>
            <Input name="password" type="password" autoComplete="off" required maxLength={63} />
          </label>
          <Button type="submit">Authenticate</Button>
        </form>
      )}
      {error ? (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
          <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>
            Retry connection
          </Button>
        </div>
      ) : (
        <p role="status" className="text-xs text-muted-foreground">
          {ready
            ? 'Use the Mac’s lock screen below. Viewing resumes automatically after unlock.'
            : authenticating
              ? 'Authenticating with macOS…'
              : credentials
                ? 'Waiting for macOS credentials.'
                : 'Connecting to macOS Screen Sharing…'}
        </p>
      )}
      {ready && (
        <Button variant="outline" onClick={() => client.current?.sendKey(0xff09, 'Tab')}>
          Send Tab
        </Button>
      )}
      <div
        ref={target}
        aria-label="macOS lock screen"
        className={
          ready && !error
            ? 'h-[55vh] min-h-64 overflow-hidden rounded-md bg-black'
            : 'h-0 overflow-hidden'
        }
        onKeyDownCapture={(event) => {
          // Let Tab leave the remote canvas; the explicit button sends a remote Tab.
          if (event.key === 'Tab') event.stopPropagation()
        }}
      />
    </section>
  )
}
