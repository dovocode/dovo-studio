import { useAppPreferences } from '@dovo/studio-core'
import { SettingsGroup, SettingsPage } from './layout'

const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const mod = mac ? '⌘' : 'Ctrl'

function Keys({ keys }: { keys: string }) {
  return (
    <span className="flex flex-wrap justify-end gap-1">
      <span className="sr-only">{keys.replaceAll('+', ' plus ')}</span>
      {keys.split('+').map((key) => (
        <kbd
          aria-hidden="true"
          key={key}
          className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs"
        >
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
                'Open task launcher (desktop)',
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
        ['Search this thread', `${mod}+F`],
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
        ['Cycle tool activity views', 'Ctrl+O'],
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
      description="Shortcuts for this device. Message shortcuts follow your Conversation settings; the desktop task launcher follows General."
    >
      {groups.map(([title, rows]) => (
        <SettingsGroup key={title} title={title}>
          <table className="w-full text-xs">
            <caption className="sr-only">{title} keyboard shortcuts</caption>
            <thead className="sr-only">
              <tr>
                <th scope="col">Action</th>
                <th scope="col">Shortcut</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map(([label, keys]) => (
                <tr key={`${label}${keys}`}>
                  <th scope="row" className="px-4 py-3 text-left font-normal">
                    {label}
                  </th>
                  <td className="px-4 py-3">
                    <Keys keys={keys} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </SettingsGroup>
      ))}
    </SettingsPage>
  )
}
