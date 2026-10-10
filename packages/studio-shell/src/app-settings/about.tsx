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
      description="Check your version, choose a release channel and manage update checks."
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
          label="Check for provider updates"
          description="Check installed agent providers when opening diagnostics. Install updates using each provider’s installer."
        >
          <Toggle
            label="Check for provider updates"
            checked={preferences.providerUpdateChecks}
            onChange={(providerUpdateChecks) => updateAppPreferences({ providerUpdateChecks })}
          />
        </SettingRow>
      </SettingsGroup>
    </SettingsPage>
  )
}
