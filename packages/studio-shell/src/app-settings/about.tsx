import { updateAppPreferences, useAppPreferences, useStudioHost } from '@dovo/studio-core'
import { LicenseSettingsRow } from './licenses'
import { UpdateSettings } from './updates'
import { SettingsPage, SettingsGroup, SettingRow, Toggle } from './layout'

export default function AboutSettings() {
  const { appInfo } = useStudioHost()
  const preferences = useAppPreferences()
  return (
    <SettingsPage
      local
      title="Updates & about"
      description="Application version, release channel and update preferences."
    >
      <SettingsGroup title="Dovo Studio">
        <SettingRow
          label="Version"
          description={appInfo ? 'Installed application version' : 'Dovo Studio for web'}
        >
          <span className="text-xs text-muted-foreground">
            {appInfo
              ? `${appInfo.version}${appInfo.channel !== 'stable' ? ` · ${appInfo.channel === 'nightly' ? 'Nightly' : 'Dev'}` : ''}`
              : 'Web'}
          </span>
        </SettingRow>
        <LicenseSettingsRow />
      </SettingsGroup>
      <UpdateSettings />
      <SettingsGroup title="Provider updates">
        <SettingRow
          label="Provider update checks"
          description="Check installed provider versions when opening diagnostics. Updates use each provider’s installer."
        >
          <Toggle
            label="Provider update checks"
            checked={preferences.providerUpdateChecks}
            onChange={(providerUpdateChecks) => updateAppPreferences({ providerUpdateChecks })}
          />
        </SettingRow>
      </SettingsGroup>
    </SettingsPage>
  )
}
