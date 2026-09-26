import { useAppPreferences } from '@dovo/studio-core'
import { SettingRow, SettingsGroup, SettingsPage } from './layout'

const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const mod = mac ? '⌘' : 'Ctrl'

function Keys({ keys }: { keys: string }) {
  return (
    <span className="flex gap-1">
      {keys.split('+').map((key) => (
        <kbd key={key} className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">
          {key}
        </kbd>
      ))}
    </span>
  )
}

export default function KeyboardShortcuts() {
  const { sendWith } = useAppPreferences()
  const groups: [string, [string, string][]][] = [
    ['Everywhere', [['Open the command palette', `${mod}+K`]]],
    [
      'Composer',
      [
        ['Send message', sendWith === 'enter' ? 'Enter' : `${mod}+Enter`],
        ['New line', sendWith === 'enter' ? 'Shift+Enter' : 'Enter'],
      ],
    ],
    ['Task', [['Show or hide the terminal', 'Ctrl+`']]],
    [
      'Folder picker',
      [
        ['Choose the selected folder', `${mod}+Enter`],
        ['Edit the folder path', `${mod}+L`],
      ],
    ],
  ]
  return (
    <SettingsPage
      title="Keyboard shortcuts"
      description="Change how messages send in General → Composer."
    >
      {groups.map(([title, rows]) => (
        <SettingsGroup key={title} title={title}>
          {rows.map(([label, keys]) => (
            <SettingRow key={label} label={label}>
              <Keys keys={keys} />
            </SettingRow>
          ))}
        </SettingsGroup>
      ))}
    </SettingsPage>
  )
}
