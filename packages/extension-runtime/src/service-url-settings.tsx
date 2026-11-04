import { useId, useState } from 'react'
import { ACCOUNT_DIRECTORY_URL, normalizeServiceUrls } from '@dovo/protocol'
import { useAppPreferences, updateAppPreferences, useSettingsDraft } from '@dovo/studio-core'
import { Button, Input, SettingsGroup, SettingsSaveBar } from '@dovo/studio-ui'

export function ServiceUrlSettings() {
  const saved = useAppPreferences()
  const [draft, setDraft] = useState<{ connectOrigin: string; artifactsOrigin: string }>()
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const id = useId()
  const fields = draft ?? saved
  const dirty =
    fields.connectOrigin !== saved.connectOrigin || fields.artifactsOrigin !== saved.artifactsOrigin
  useSettingsDraft(dirty)
  const save = () => {
    if (!dirty) return
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
              onChange={(event) => {
                setDraft({
                  connectOrigin: event.target.value,
                  artifactsOrigin: fields.artifactsOrigin,
                })
                setNotice('')
              }}
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
              onChange={(event) => {
                setDraft({
                  connectOrigin: fields.connectOrigin,
                  artifactsOrigin: event.target.value,
                })
                setNotice('')
              }}
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
        </div>
      </SettingsGroup>
      <SettingsSaveBar
        dirty={dirty}
        saving={false}
        saveLabel="Save service URLs"
        saveType="submit"
        saved={!!notice}
        description="Service URLs are saved on this device."
        changeCount={
          Number(fields.connectOrigin !== saved.connectOrigin) +
          Number(fields.artifactsOrigin !== saved.artifactsOrigin)
        }
        onSave={save}
        onDiscard={() => {
          setDraft(undefined)
          setError('')
          setNotice('')
        }}
      />
    </form>
  )
}
