import { updateAppPreferences, useAppPreferences } from '@dovo/studio-core'
import { SettingRow, SettingsGroup, SettingsPage, Segmented, Toggle } from './layout'

const mac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
const mod = mac ? '⌘' : 'Ctrl'

export default function ConversationSettings() {
  const preferences = useAppPreferences()
  return (
    <SettingsPage
      local
      title="Conversation"
      description="How you write messages and read agent responses."
    >
      <SettingsGroup title="Writing & follow-ups">
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
          description="Queue waits for the current turn to finish. Steer guides the running turn right away."
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
        {(
          [
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
          ] as const
        ).map(([key, label, description]) => (
          <SettingRow key={key} label={label} description={description}>
            <Toggle
              label={label}
              checked={preferences[key]}
              onChange={(value) => updateAppPreferences({ [key]: value })}
            />
          </SettingRow>
        ))}
      </SettingsGroup>
      <SettingsGroup title="Reading responses">
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
        <SettingRow
          label="Tool activity"
          description="Show commands, edits and searches expanded, collapsed, or keep only replies visible. Ctrl+O switches between them."
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
          description="Include tool output, full inputs and raw events. Commands stay visible when this is off."
        >
          <Toggle
            label="Show tool call details"
            checked={preferences.showToolDetails}
            onChange={(showToolDetails) => updateAppPreferences({ showToolDetails })}
          />
        </SettingRow>
      </SettingsGroup>
    </SettingsPage>
  )
}
