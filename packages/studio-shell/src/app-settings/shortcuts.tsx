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
  const { sendWith, taskLauncherShortcut } = useAppPreferences()
  const groups: [string, [string, string][]][] = [
    [
      'Everywhere',
      [
        ['Open the command palette', `${mod}+K`],
        ['Show keyboard shortcuts', `${mod}+/`],
        ...(taskLauncherShortcut
          ? ([
              [
                'Start task from any app (desktop)',
                taskLauncherShortcut.replace('CommandOrControl', mod),
              ],
            ] as [string, string][])
          : []),
      ],
    ],
    [
      'Composer',
      [
        ['Send message', sendWith === 'enter' ? 'Enter' : `${mod}+Enter`],
        ['New line', sendWith === 'enter' ? 'Shift+Enter' : 'Enter'],
      ],
    ],
    [
      'Tasks',
      [
        ['New task', `${mod}+N`],
        ['Go to a task', `${mod}+P`],
        ['Search all conversations', `${mod}+Shift+F`],
        ['Next task', 'Ctrl+Tab'],
        ['Previous task', 'Ctrl+Shift+Tab'],
        ...(mac
          ? ([
              ['Next task', '⌘+Shift+]'],
              ['Previous task', '⌘+Shift+['],
            ] as [string, string][])
          : []),
        ['Stop the running agent', 'Esc'],
        ['Ask a side question', `${mod}+;`],
        ['Close the side-by-side task', `${mod}+\\`],
        ['Show or hide changes', `${mod}+Shift+D`],
        ['Switch folded steps, every step and replies only', 'Ctrl+O'],
        ['Show or hide the terminal', 'Ctrl+`'],
      ],
    ],
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
            <SettingRow key={`${label}${keys}`} label={label}>
              <Keys keys={keys} />
            </SettingRow>
          ))}
        </SettingsGroup>
      ))}
    </SettingsPage>
  )
}
