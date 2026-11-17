import { useState } from 'react'
import {
  applicationShortcuts,
  applicationShortcutLabel,
  captureApplicationShortcut,
  shortcutConflict,
  updateAppPreferences,
  useAppPreferences,
  type ApplicationShortcut,
} from '@dovo/studio-core'
import { Button, Input } from '@dovo/studio-ui'
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
  const { sendWith, taskLauncherShortcut, shortcutOverrides } = useAppPreferences()
  const [error, setError] = useState('')
  const save = (value: typeof shortcutOverrides) =>
    setError(
      updateAppPreferences({ shortcutOverrides: value })
        ? ''
        : 'Could not save shortcuts on this device. Retry in Settings.',
    )
  const groups: [string, [string, string][]][] = [
    [
      'Everywhere',
      [
        ...(taskLauncherShortcut
          ? ([
              [
                'Open thread launcher (desktop)',
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
        ['Switch rich text and Markdown source', `${mod}+Shift+M`],
        ['Bold (rich text)', `${mod}+B`],
        ['Italic (rich text)', `${mod}+I`],
        ['Inline code (rich text)', `${mod}+E`],
      ],
    ],
    [
      'Threads',
      [
        ['Next thread', 'Ctrl+Tab'],
        ['Previous thread', 'Ctrl+Shift+Tab'],
        ...(mac
          ? ([
              ['Next thread', '⌘+Shift+]'],
              ['Previous thread', '⌘+Shift+['],
            ] as [string, string][])
          : []),
        ['Stop the running agent', 'Esc'],
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
      description="Shortcuts for this device. Message shortcuts follow your Conversation settings; the desktop thread launcher follows General."
    >
      <SettingsGroup title="Application shortcuts">
        <p className="px-4 py-2 text-xs text-muted-foreground">
          Select a shortcut field and press a key with Ctrl, Command or Alt. Changes apply on this
          device. Editors, terminals and open dialogs keep their keys.
        </p>
        {error && (
          <p role="alert" className="px-4 text-xs text-destructive">
            {error}
          </p>
        )}
        <div className="divide-y">
          {(Object.keys(applicationShortcuts) as ApplicationShortcut[]).map((id) => (
            <div key={id} className="flex flex-wrap items-center gap-2 px-4 py-3 text-xs">
              <label className="min-w-48 flex-1" htmlFor={`shortcut-${id}`}>
                {applicationShortcuts[id].label}
              </label>
              <Input
                id={`shortcut-${id}`}
                className="h-8 w-40"
                readOnly
                value={applicationShortcutLabel(id, shortcutOverrides)}
                onKeyDown={(event) => {
                  if (event.key === 'Tab') return
                  event.preventDefault()
                  event.stopPropagation()
                  if (event.nativeEvent.isComposing || event.repeat) return
                  const binding = captureApplicationShortcut(event)
                  if (!binding) {
                    setError(
                      'Press a key with Ctrl, Command or Alt. Use Unassign to remove a shortcut.',
                    )
                    return
                  }
                  const conflict = shortcutConflict(id, binding, shortcutOverrides)
                  if (conflict) {
                    setError(conflict)
                    return
                  }
                  save({ ...shortcutOverrides, [id]: binding })
                }}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  save({ ...shortcutOverrides, [id]: null })
                }}
              >
                Unassign
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={shortcutOverrides[id] === undefined}
                onClick={() => {
                  const conflict = shortcutConflict(
                    id,
                    applicationShortcuts[id].binding,
                    shortcutOverrides,
                  )
                  if (conflict) {
                    setError(conflict)
                    return
                  }
                  const next = { ...shortcutOverrides }
                  delete next[id]
                  save(next)
                }}
              >
                Reset
              </Button>
            </div>
          ))}
        </div>
        <Button
          className="m-4"
          size="sm"
          variant="outline"
          onClick={() => {
            save({})
          }}
        >
          Reset all application shortcuts
        </Button>
      </SettingsGroup>
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
