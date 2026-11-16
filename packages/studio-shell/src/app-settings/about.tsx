import {
  updateAppPreferences,
  useAppPreferences,
  useStudioHost,
  useWorkspace,
} from '@dovo/studio-core'
import { Button } from '@dovo/studio-ui'
import { openReportProblem } from '../report-problem/open-state'
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
      description="Check your version and manage update preferences."
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
      <HelpSettings />
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

function HelpSettings() {
  const { runtimes } = useWorkspace()
  const supported = runtimes.some((entry) => entry.snapshot?.problemReportsSupported === true)
  return (
    <SettingsGroup title="Help">
      <SettingRow
        label="Report a problem"
        description={
          supported
            ? 'Start a thread where an agent reads redacted diagnostics and the Dovo source for your version, then drafts an issue for you to review.'
            : 'Update a connected computer to report problems from Dovo.'
        }
      >
        <Button variant="outline" disabled={!supported} onClick={openReportProblem}>
          Report a problem…
        </Button>
      </SettingRow>
    </SettingsGroup>
  )
}
