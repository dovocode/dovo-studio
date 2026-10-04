import { LicenseSettingsRow } from './licenses'
import { DiffSettingsRows } from './diffs'
import { NotificationSettingsRows } from './notifications'
import { Input } from '@dovo/studio-ui'
import { useStudioHost } from '@dovo/studio-core'
import { useEffect, useState } from 'react'
import { taskLauncherShortcuts } from '@dovo/protocol'
import {
  formatDateTime,
  taskSortOptions,
  updateAppPreferences,
  useAppPreferences,
} from '@dovo/studio-core'
import { UpdateSettings } from './updates'
import {
  HarnessUpdates,
  Button,
  SettingsScopePage,
  TaskDefaultSettings,
  TaskBehaviorSettings,
  ChoicePicker,
} from '@dovo/studio-ui'
import { SettingRow, SettingsGroup, Segmented, Toggle } from './layout'

const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const mod = mac ? '⌘' : 'Ctrl'

export default function GeneralSettings() {
  const { appInfo, taskLauncher } = useStudioHost()
  const preferences = useAppPreferences()
  const [shortcutError, setShortcutError] = useState('')
  useEffect(() => {
    if (!taskLauncher) return
    let current = true
    void taskLauncher.configure(preferences.taskLauncherShortcut).then(
      (result) => {
        if (current) setShortcutError(result.error ?? '')
      },
      (cause: unknown) => {
        if (current) setShortcutError(String(cause))
      },
    )
    return () => {
      current = false
    }
  }, [taskLauncher, preferences.taskLauncherShortcut])
  return (
    <SettingsScopePage
      title="General"
      description="Task defaults, organization and app behavior."
      localChildren={
        <div className="space-y-6">
          <GeneralBehaviorRows />
          <NotificationSettingsRows />
          <DiffSettingsRows />
          {appInfo && (
            <SettingsGroup title="About">
              <SettingRow label="Dovo Studio" description="Installed app version">
                <span className="text-xs text-muted-foreground">
                  {appInfo.version}
                  {appInfo.channel !== 'stable'
                    ? ` · ${appInfo.channel === 'nightly' ? 'Nightly' : 'Dev'}`
                    : ''}
                </span>
              </SettingRow>
            </SettingsGroup>
          )}
          <UpdateSettings />
          <SettingsGroup title="Navigation">
            {taskLauncher && (
              <SettingRow
                label="Global new task shortcut"
                description={
                  shortcutError ||
                  'Open the task launcher from any app. Select a server, project and favorite agent.'
                }
              >
                <ChoicePicker
                  aria-label="Global new task shortcut"
                  value={preferences.taskLauncherShortcut}
                  onValueChange={(value) => {
                    const shortcut = taskLauncherShortcuts.find((shortcut) => shortcut === value)
                    if (shortcut !== undefined)
                      updateAppPreferences({ taskLauncherShortcut: shortcut })
                  }}
                >
                  <option value="CommandOrControl+Shift+Space">{mod} + Shift + Space</option>
                  <option value="CommandOrControl+Alt+N">{mod} + Alt + N</option>
                  <option value="">Disabled</option>
                </ChoicePicker>
              </SettingRow>
            )}
            <SettingRow label="Issues" description="Show code-host issues in the sidebar.">
              <Toggle
                label="Show Issues"
                checked={preferences.showIssues}
                onChange={(showIssues) => updateAppPreferences({ showIssues })}
              />
            </SettingRow>
            <SettingRow label="Jira" description="Show Jira issues in a separate sidebar view.">
              <Toggle
                label="Show Jira"
                checked={preferences.showJira}
                onChange={(showJira) => updateAppPreferences({ showJira })}
              />
            </SettingRow>
          </SettingsGroup>
          <SettingsGroup title="Task list">
            <SettingRow
              label="Default sort"
              description="How the task sidebar is ordered when Dovo opens."
            >
              <ChoicePicker
                aria-label="Default task sort"
                className="h-8 min-w-40 rounded-md px-2 text-xs"
                value={preferences.taskSort}
                onValueChange={(taskSort) =>
                  updateAppPreferences({
                    taskSort:
                      taskSort === 'activity' ||
                      taskSort === 'newest' ||
                      taskSort === 'oldest' ||
                      taskSort === 'priority' ||
                      taskSort === 'project' ||
                      taskSort === 'title'
                        ? taskSort
                        : preferences.taskSort,
                  })
                }
              >
                {taskSortOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </ChoicePicker>
            </SettingRow>
          </SettingsGroup>
          <SettingsGroup title="Date & time">
            <SettingRow
              label="Time format"
              description={`Example: ${formatDateTime(new Date(2026, 8, 25, 21, 30))}`}
            >
              <Segmented
                label="Time format"
                value={preferences.timeFormat}
                options={[
                  ['auto', 'Automatic'],
                  ['12h', '12-hour'],
                  ['24h', '24-hour'],
                ]}
                onChange={(timeFormat) => updateAppPreferences({ timeFormat })}
              />
            </SettingRow>
          </SettingsGroup>
          <SettingsGroup title="Conversation">
            <SettingRow
              label="Send messages with"
              description={
                preferences.sendWith === 'enter'
                  ? 'Enter sends. Shift+Enter adds a new line.'
                  : `${mod}+Enter sends. Enter adds a new line.`
              }
            >
              <Segmented
                label="Send messages with"
                value={preferences.sendWith}
                options={[
                  ['enter', 'Enter'],
                  ['mod-enter', `${mod}+Enter`],
                ]}
                onChange={(sendWith) => updateAppPreferences({ sendWith })}
              />
            </SettingRow>
            <SettingRow
              label="Follow-ups while a task runs"
              description={
                preferences.followUp === 'queue'
                  ? 'Queued messages are sent when the current turn finishes. Steer stays one click away.'
                  : 'Messages guide the current turn right away. Queue stays one click away.'
              }
            >
              <Segmented
                label="Follow-ups while a task runs"
                value={preferences.followUp}
                options={[
                  ['queue', 'Queue'],
                  ['steer', 'Steer'],
                ]}
                onChange={(followUp) => updateAppPreferences({ followUp })}
              />
            </SettingRow>
            <SettingRow
              label="Tool activity"
              description="Whether commands, edits and searches in each turn start open, folded, or stay hidden so only replies show. Ctrl+O switches between them."
            >
              <Segmented
                label="Tool activity"
                value={preferences.toolActivity}
                options={[
                  ['collapsed', 'Collapsed'],
                  ['expanded', 'Expanded'],
                  ['hidden', 'Replies only'],
                ]}
                onChange={(toolActivity) => updateAppPreferences({ toolActivity })}
              />
            </SettingRow>
            <SettingRow
              label="Show tool call details"
              description="Show tool output, full inputs and raw events in threads. Commands stay visible when this is off."
            >
              <Toggle
                label="Show tool call details"
                checked={preferences.showToolDetails}
                onChange={(showToolDetails) => updateAppPreferences({ showToolDetails })}
              />
            </SettingRow>
          </SettingsGroup>
          <SettingsGroup title="Confirmations">
            <SettingRow
              label="Confirm before archiving a task"
              description="Archived tasks can always be restored from Archived tasks."
            >
              <Toggle
                label="Confirm before archiving a task"
                checked={preferences.confirmArchive}
                onChange={(confirmArchive) => updateAppPreferences({ confirmArchive })}
              />
            </SettingRow>
            <SettingRow
              label="Confirm before stopping a running task"
              description="Stopping ends the agent's current turn and pauses queued messages."
            >
              <Toggle
                label="Confirm before stopping a running task"
                checked={preferences.confirmStop}
                onChange={(confirmStop) => updateAppPreferences({ confirmStop })}
              />
            </SettingRow>
          </SettingsGroup>
        </div>
      }
    >
      {({ scope, repository }) => (
        <>
          <TaskDefaultSettings inline scope={scope} repository={repository} />
          <TaskBehaviorSettings scope={scope} repository={repository} />
          <HarnessUpdates />
        </>
      )}
    </SettingsScopePage>
  )
}

function GeneralBehaviorRows() {
  const preferences = useAppPreferences()
  const host = useStudioHost()
  const switches = [
    [
      'providerUpdateChecks',
      'Provider update checks',
      'Check installed provider versions for available updates when opening diagnostics. Updates use each provider’s installer.',
    ],
    ['projectGrouping', 'Project grouping', 'Combine matching repositories across environments.'],
    [
      'workingSection',
      'Working section',
      'Fold running tasks into Working. Tasks return to Active when they need your input.',
    ],
    [
      'inAppNotifications',
      'In-app notifications',
      'Show an alert when another task finishes, fails or needs input while Dovo has focus.',
    ],
    [
      'showSkillsInSlashMenu',
      'Show skills in slash menu',
      'Include skills in the / menu. Skills always appear when you type $.',
    ],
    [
      'markdownComposerPreview',
      'Formatted composer preview',
      'Show rendered Markdown above the message as you type.',
    ],
    [
      'collapseComposerOnScroll',
      'Collapse composer on scroll',
      'Collapse when reading older messages. Focus the composer to expand it.',
    ],
    [
      'hideWhitespaceChanges',
      'Hide whitespace changes',
      'Hide files whose only changes are whitespace.',
    ],
    [
      'proactivePanels',
      'Proactive panels',
      'Open linked pull requests first, otherwise open Changes for edits to at least 3 files or 50 lines.',
    ],
    ['confirmUnpin', 'Unpin confirmation', 'Ask before removing a task from Pinned.'],
    [
      'confirmDelete',
      'Delete confirmation',
      'Ask before permanently deleting a task and its conversation.',
    ],
  ] as const
  return (
    <>
      {(
        [
          ['Organization', ['projectGrouping', 'workingSection']],
          [
            'Behavior',
            [
              'inAppNotifications',
              'showSkillsInSlashMenu',
              'markdownComposerPreview',
              'collapseComposerOnScroll',
              'hideWhitespaceChanges',
              'proactivePanels',
            ],
          ],
          ['Confirmations', ['confirmUnpin', 'confirmDelete']],
          ['Providers', ['providerUpdateChecks']],
        ] as const
      ).map(([title, keys]) => (
        <SettingsGroup key={title} title={`${title} · this device`}>
          {switches
            .filter(([key]) => keys.some((value) => value === key))
            .map(([key, label, description]) => (
              <SettingRow key={key} label={label} description={description}>
                <Toggle
                  label={label}
                  checked={preferences[key]}
                  onChange={(value) => updateAppPreferences({ [key]: value })}
                />
              </SettingRow>
            ))}
        </SettingsGroup>
      ))}
      <SettingsGroup title="Ordering & streaming · this device">
        <SettingRow label="Project order" description="Order of projects in the project picker.">
          <ChoicePicker
            aria-label="Project order"
            value={preferences.projectOrder}
            onValueChange={(value) => {
              if (value === 'name' || value === 'activity' || value === 'user-message')
                updateAppPreferences({ projectOrder: value })
            }}
          >
            <option value="name">Name</option>
            <option value="activity">Last activity</option>
            <option value="user-message">Last user message</option>
          </ChoicePicker>
        </SettingRow>
        <SettingRow
          label="Response streaming"
          description="Choose when the latest assistant paragraph becomes visible."
        >
          <Segmented
            label="Response streaming"
            value={preferences.responseStreaming}
            options={[
              ['live', 'Live text'],
              ['paragraphs', 'Finished paragraphs'],
            ]}
            onChange={(responseStreaming) => updateAppPreferences({ responseStreaming })}
          />
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title="Application · this device">
        <SettingRow
          label="Mobile devices"
          description="Pair Dovo on iPhone or Android with your computers using a pairing code."
        >
          <Button variant="outline" onClick={() => host.navigate({ viewId: 'runtime' })}>
            Pair a device
          </Button>
        </SettingRow>
        <LicenseSettingsRow />
        <SettingRow
          label="Background activity"
          description="Balanced pauses refreshes in hidden windows. Reduced also slows overview refreshes while visible."
        >
          <Segmented
            label="Background activity"
            value={preferences.backgroundActivity}
            options={[
              ['balanced', 'Balanced'],
              ['reduced', 'Reduced'],
            ]}
            onChange={(backgroundActivity) => updateAppPreferences({ backgroundActivity })}
          />
        </SettingRow>
        {host.appInfo && (
          <SettingRow
            label="Quit shortcut"
            description="Hold requires holding the shortcut for 600 ms. Two quick presses also quit."
          >
            <Segmented
              label="Quit shortcut"
              value={preferences.quitShortcut}
              options={[
                ['immediate', 'Immediate'],
                ['hold', 'Hold'],
                ['disabled', 'Disabled'],
              ]}
              onChange={(quitShortcut) => updateAppPreferences({ quitShortcut })}
            />
          </SettingRow>
        )}
        <SettingRow
          label="Text generation model"
          description="Choose the harness, model and reasoning for task titles and dictation on each computer."
        >
          <Button variant="outline" onClick={() => host.navigate({ viewId: 'agents' })}>
            Configure text generation
          </Button>
        </SettingRow>
        <SettingRow
          label="Diagnostics"
          description="Inspect provider installations, runtime state and recorded activity."
        >
          <Button variant="outline" onClick={() => host.navigate({ viewId: 'activity' })}>
            View activity
          </Button>
        </SettingRow>
      </SettingsGroup>
      <SettingsGroup title="Projects · this device">
        <SettingRow
          label="Add project starts in"
          description="Starting folder on the selected computer. Leave empty to use its default."
        >
          <Input
            aria-label="Add project starts in"
            className="max-w-64"
            value={preferences.addProjectStartsIn}
            onChange={(event) => updateAppPreferences({ addProjectStartsIn: event.target.value })}
            placeholder="~/Code"
          />
        </SettingRow>
      </SettingsGroup>
    </>
  )
}
