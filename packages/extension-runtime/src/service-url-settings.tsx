import { useId, useState } from 'react'
import { ACCOUNT_DIRECTORY_URL, normalizeServiceUrls } from '@dovo/protocol'
import { useAppPreferences, updateAppPreferences } from '@dovo/studio-core'
import { Button, Input } from '@dovo/studio-ui'

export function ServiceUrlSettings() {
  const saved = useAppPreferences()
  const [draft, setDraft] = useState<{ connectOrigin: string; artifactsOrigin: string }>()
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const id = useId()
  const fields = draft ?? saved
  const dirty =
    fields.connectOrigin !== saved.connectOrigin || fields.artifactsOrigin !== saved.artifactsOrigin
  return (
    <form
      className="space-y-3 rounded-md border p-4"
      aria-label="Dovo service URLs"
      onSubmit={(event) => {
        event.preventDefault()
        try {
          const normalized = normalizeServiceUrls(fields)
          updateAppPreferences({
            ...normalized,
            connectOrigin:
              normalized.connectOrigin === ACCOUNT_DIRECTORY_URL ? '' : normalized.connectOrigin,
          })
          setDraft(undefined)
          setError('')
          setNotice('Service URLs saved on this device.')
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Check the service URLs')
        }
      }}
    >
      <h2 className="text-sm font-medium">Dovo services</h2>
      <p className="text-xs text-muted-foreground">
        Saved on this device. Account sessions stay separate for each Connect server. New computer
        setups use this URL; existing Connect connections keep their current server until disabled
        and enabled again through LAN / VPN pairing.
      </p>
      <label className="block space-y-1 text-sm" htmlFor={`${id}-connect`}>
        <span>Dovo Connect URL</span>
        <Input
          id={`${id}-connect`}
          value={fields.connectOrigin}
          placeholder={ACCOUNT_DIRECTORY_URL}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(event) => {
            setDraft({ connectOrigin: event.target.value, artifactsOrigin: fields.artifactsOrigin })
            setNotice('')
          }}
        />
      </label>
      <label className="block space-y-1 text-sm" htmlFor={`${id}-artifacts`}>
        <span>Dovo Artifacts URL</span>
        <Input
          id={`${id}-artifacts`}
          value={fields.artifactsOrigin}
          placeholder="Automatic — from Connect"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          onChange={(event) => {
            setDraft({ connectOrigin: fields.connectOrigin, artifactsOrigin: event.target.value })
            setNotice('')
          }}
        />
      </label>
      <p className="text-xs text-muted-foreground">
        Leave Artifacts blank to use the store announced by Connect. A custom URL must also be
        configured on your Connect broker and artifact server; Studio checks they match before
        sharing.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" disabled={!dirty}>
          Save service URLs
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => {
            setDraft({ connectOrigin: '', artifactsOrigin: '' })
            setError('')
            setNotice('')
          }}
        >
          Use defaults
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="text-xs text-muted-foreground">
          {notice}
        </p>
      )}
    </form>
  )
}
