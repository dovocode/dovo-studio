import { useEffect } from 'react'
import { Effect } from 'effect'
import QRCode from 'qrcode'
import { pairingInvitationUrl } from '@dovo/protocol'
import { clientTaskScope, startPolling } from '@dovo/studio-core'
import { useApplicationState } from '@dovo/studio-core/state'
import { Button, Input, FormField } from '@dovo/studio-ui'
export function PairingGuide({
  code,
  fallbackAddress,
  pending,
}: {
  code: { code: string; expiresAt: string; addresses?: { name: string; address: string }[] }
  fallbackAddress?: string
  pending: boolean
}) {
  const [address, setAddress] = useApplicationState(
    code.addresses?.[0]?.address ?? fallbackAddress ?? '',
  )
  const [now, setNow] = useApplicationState(Date.now())
  const [qr, setQr] = useApplicationState('')
  const [error, setError] = useApplicationState('')
  const [copied, setCopied] = useApplicationState(false)
  const remaining = Math.max(0, Math.ceil((Date.parse(code.expiresAt) - now) / 1000))
  useEffect(() => {
    const clock = startPolling(
      Effect.sync(() => setNow(Date.now())),
      { interval: 1000, onError: () => {} },
    )
    return () => {
      void clock.stop()
    }
  }, [])
  useEffect(() => {
    setQr('')
    setError('')
    setCopied(false)
    const commands = clientTaskScope()
    void commands.run(
      Effect.tryPromise({
        try: () =>
          QRCode.toDataURL(
            pairingInvitationUrl({ address, code: code.code, expiresAt: code.expiresAt }),
            { width: 240, margin: 4 },
          ),
        catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
      }).pipe(
        Effect.tap((value) => Effect.sync(() => setQr(value))),
        Effect.asVoid,
        Effect.catchAll((cause) => Effect.sync(() => setError(cause.message))),
      ),
    )
    return () => {
      void commands.stop()
    }
  }, [address, code.code, code.expiresAt])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
    } catch {
      setError('Could not copy. Select the address below and copy it manually.')
    }
  }
  const addresses = code.addresses ?? []
  const selectedAddress = addresses.some((item) => item.address === address) ? address : ''
  return (
    <div className="space-y-3 rounded border bg-card p-3">
      <h3 className="text-sm font-medium">Connect your phone</h3>
      <p className="text-xs text-muted-foreground">Use the same Wi-Fi or VPN on both devices.</p>
      {!!addresses.length && (
        <FormField label="Network address">
          <select
            aria-label="Network address"
            className="h-9 w-full rounded-md border bg-background px-2 text-xs"
            value={selectedAddress}
            onChange={(event) => setAddress(event.target.value)}
          >
            {addresses.map((item) => (
              <option key={item.address} value={item.address}>
                {/^(utun|tun|tap|tailscale|netbird)/i.test(item.name) ? 'VPN' : 'Local network'} (
                {item.name}) · {item.address}
              </option>
            ))}
            <option value="">Enter another address…</option>
          </select>
        </FormField>
      )}
      {(!selectedAddress || !addresses.length) && (
        <FormField label="Computer address">
          <Input
            value={address}
            onChange={(event) => setAddress(event.target.value.trim())}
            placeholder="http://your-vpn-address:8787"
          />
        </FormField>
      )}
      {!remaining ? (
        <p role="status" className="text-sm">
          Code expired. Generate a new pairing code above.
        </p>
      ) : pending ? (
        <p role="status" className="text-sm">
          Request received — approve your phone above to finish pairing.
        </p>
      ) : (
        <div className="flex flex-wrap items-start gap-4">
          {qr && (
            <img
              className="shrink-0"
              src={qr}
              width={208}
              height={208}
              alt="Pairing QR code: opens Dovo with this address and code"
            />
          )}
          <div className="min-w-[160px] flex-1 space-y-3">
            <p className="text-xs text-muted-foreground">
              Scan with the iPhone Camera, review the address in Dovo, then tap Connect.
            </p>
            <p className="text-xs text-muted-foreground">
              Or enter the address and this code in Computers:
            </p>
            <p className="select-all font-mono text-2xl tracking-widest">{code.code}</p>
            <Button size="sm" variant="outline" disabled={!qr} onClick={() => void copy()}>
              {copied ? 'Address copied' : 'Copy address'}
            </Button>
            <p role="status" className="text-xs text-muted-foreground">
              Single use · {remaining}s remaining
            </p>
          </div>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Approve the named phone here when prompted. Pairing grants access to files, agents and
        terminal commands.
      </p>
      {code.addresses?.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No network address is available from this listener. If it listens only on localhost, use
          Enable LAN / VPN access above, or change and restart your externally managed listener. A
          proxy address can be entered above.
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
