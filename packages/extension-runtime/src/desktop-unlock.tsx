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
}: {
  id: string
  onClose: () => void
  unlockUrl: (id: string) => Promise<string>
}) {
  const currentUnlockUrl = useRef(unlockUrl)
  currentUnlockUrl.current = unlockUrl
  const target = useRef<HTMLDivElement>(null)
  const client = useRef<RFB | null>(null)
  const [credentials, setCredentials] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!target.current) return
    setError('')
    setCredentials(false)
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
    void (async () => {
      const { default: RFB } = await import('@novnc/novnc')
      if (disposed) return
      const url = await currentUnlockUrl.current(id)
      if (disposed) return
      socket = new WebSocket(url)
      socket.addEventListener('close', (event) => {
        if (!disposed && event.code !== 1000 && event.reason && !failed) {
          failed = true
          setError(event.reason)
        }
      })
      rfb = new RFB(element, socket, { shared: true })
      client.current = rfb
      rfb.scaleViewport = true
      rfb.resizeSession = false
      rfb.clipViewport = false
      rfb.addEventListener('credentialsrequired', () => {
        if (!disposed) setCredentials(true)
      })
      rfb.addEventListener('connect', () => {
        if (disposed) return
        setCredentials(false)
        setReady(true)
        rfb?.focus()
      })
      rfb.addEventListener('securityfailure', () => {
        if (disposed) return
        failed = true
        setCredentials(false)
        setError(
          'macOS refused authentication. Check the account’s Screen Sharing access, then close and try again.',
        )
      })
      rfb.addEventListener('disconnect', () => {
        if (disposed) return
        client.current = null
        setReady(false)
        setCredentials(false)
        if (!failed)
          setError(
            'Screen Sharing disconnected. Close this panel to check the desktop or try again.',
          )
      })
    })().catch((cause: unknown) => {
      failed = true
      rfb?.disconnect()
      socket?.close()
      if (!disposed) {
        client.current = null
        setError(cause instanceof Error ? cause.message : String(cause))
      }
    })
    return () => {
      disposed = true
      client.current = null
      rfb?.disconnect()
      socket?.close()
    }
  }, [id])
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
          }}
        >
          <label className="space-y-1 text-xs">
            <span>Mac username</span>
            <Input name="username" autoComplete="off" required maxLength={63} />
          </label>
          <label className="space-y-1 text-xs">
            <span>Mac password</span>
            <Input name="password" type="password" autoComplete="off" required maxLength={63} />
          </label>
          <Button type="submit">Authenticate</Button>
        </form>
      )}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : (
        <p role="status" className="text-xs text-muted-foreground">
          {ready
            ? 'Use the Mac’s lock screen below. Viewing resumes automatically after unlock.'
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
