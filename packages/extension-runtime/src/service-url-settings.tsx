import { useEffect, useId, useState } from 'react'
import { ACCOUNT_DIRECTORY_URL, normalizeServiceUrls } from '@dovo/protocol'
import {
  useAppPreferences,
  useAppPreferenceSaveError,
  updateAppPreferences,
  useSettingsDraft,
} from '@dovo/studio-core'
import { Button, Input, SettingsGroup, SettingsSaveBar, SettingsStorageInfo } from '@dovo/studio-ui'

type ServiceUrlField = 'connectOrigin' | 'artifactsOrigin'
type ServiceUrlDraft = Partial<Record<ServiceUrlField, { before: string; value: string }>>
const labels = { connectOrigin: 'Dovo Connect URL', artifactsOrigin: 'Dovo Artifacts URL' }

export function ServiceUrlSettings() {
  const saved = useAppPreferences()
  const preferenceError = useAppPreferenceSaveError()
  const [draft, setDraft] = useState<ServiceUrlDraft>({})
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [failedDraft, setFailedDraft] = useState<ServiceUrlDraft>()
  useEffect(() => {
    if (!failedDraft || preferenceError !== null) return
    setFailedDraft(undefined)
    setDraft((current) => (current === failedDraft ? {} : current))
    setError('')
    setNotice('Service URLs saved on this device.')
  }, [failedDraft, preferenceError])
  const id = useId()
  const fields = {
    connectOrigin: draft.connectOrigin?.value ?? saved.connectOrigin,
    artifactsOrigin: draft.artifactsOrigin?.value ?? saved.artifactsOrigin,
  }
  const changeCount = Object.keys(draft).length
  const dirty = changeCount > 0
  const edit = (field: ServiceUrlField, value: string) => {
    setDraft((previous) => {
      const next = { ...previous }
      if (value === saved[field]) delete next[field]
      else next[field] = { before: previous[field]?.before ?? saved[field], value }
      return next
    })
    setError('')
    setNotice('')
  }
  useSettingsDraft(dirty)
  const save = () => {
    if (!dirty) return
    setFailedDraft(undefined)
    try {
      const saved = updateAppPreferences((current) => {
        const normalized = normalizeServiceUrls({
          connectOrigin: draft.connectOrigin?.value ?? current.connectOrigin,
          artifactsOrigin: draft.artifactsOrigin?.value ?? current.artifactsOrigin,
        })
        if (normalized.connectOrigin === ACCOUNT_DIRECTORY_URL) normalized.connectOrigin = ''
        const patch: Partial<typeof normalized> = {}
        for (const field of ['connectOrigin', 'artifactsOrigin'] as const) {
          const change = draft[field]
          if (!change) continue
          if (current[field] !== change.before && current[field] !== normalized[field])
            throw new Error(
              `${labels[field]} changed in another window. Discard the edit and review the saved URL.`,
            )
          patch[field] = normalized[field]
        }
        return patch
      })
      if (saved === false) {
        setFailedDraft(draft)
        throw new Error('Could not save service URLs on this device. Retry saving.')
      }
      setDraft({})
      setError('')
      setNotice('Service URLs saved on this device.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Check the service URLs')
    }
  }
  return (
    <form
      className="space-y-4"
      aria-label="Dovo service URLs"
      onSubmit={(event) => {
        event.preventDefault()
        save()
      }}
    >
      <SettingsGroup
        title="Dovo services"
        saveRequired
        description="Saved on this device. Account sessions stay separate for each Connect server."
      >
        <div className="space-y-4 pt-2">
          <label className="block space-y-1 text-[0.8125rem]" htmlFor={`${id}-connect`}>
            <span className="font-medium">Dovo Connect URL</span>
            <Input
              id={`${id}-connect`}
              aria-describedby={`${id}-connect-help`}
              value={fields.connectOrigin}
              placeholder={ACCOUNT_DIRECTORY_URL}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(event) => edit('connectOrigin', event.target.value)}
            />
          </label>
          <p id={`${id}-connect-help`} className="text-xs leading-relaxed text-muted-foreground">
            Used for new computer setup. Existing Connect connections keep their server until
            Connect is disabled and enabled again through LAN / VPN pairing.
          </p>
          <label className="block space-y-1 text-[0.8125rem]" htmlFor={`${id}-artifacts`}>
            <span className="font-medium">Dovo Artifacts URL</span>
            <Input
              id={`${id}-artifacts`}
              aria-describedby={`${id}-artifacts-help`}
              value={fields.artifactsOrigin}
              placeholder="Automatic — from Connect"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(event) => edit('artifactsOrigin', event.target.value)}
            />
          </label>
          <p id={`${id}-artifacts-help`} className="text-xs leading-relaxed text-muted-foreground">
            Leave Artifacts blank to use the store announced by Connect. A custom URL must also be
            configured on your Connect broker and artifact server; Studio checks they match before
            sharing.
          </p>
          <div className="flex flex-wrap items-center gap-2 border-t border-border/50 pt-3">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                edit('connectOrigin', '')
                edit('artifactsOrigin', '')
              }}
            >
              Reset to defaults
            </Button>
          </div>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
      </SettingsGroup>
      {!dirty ? (
        <SettingsStorageInfo>
          <span role={notice ? 'status' : undefined}>
            {notice || 'This device · no unsaved service URL changes.'}
          </span>
        </SettingsStorageInfo>
      ) : (
        <SettingsSaveBar
          dirty={dirty}
          saving={false}
          saveLabel="Save service URLs"
          saveType="submit"
          description="Save service URLs to apply these changes on this device."
          changeCount={changeCount}
          onSave={save}
          onDiscard={() => {
            setDraft({})
            setError('')
            setNotice('')
          }}
        />
      )}
    </form>
  )
}
