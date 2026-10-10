import { updateAppPreferences, useAppPreferences } from '@dovo/studio-core'
import { SettingRow, SettingsGroup, SettingsPage, Toggle } from './layout'
import { SettingsSelect } from './settings-select'

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
      <SettingsGroup title="Writing messages">
        <SettingRow
          label="Send messages with"
          description={
            preferences.sendWith === 'enter'
              ? 'Enter sends. Shift+Enter adds a new line.'
              : `${mod}+Enter sends. Enter adds a new line.`
          }
        >
          <SettingsSelect
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
          description="Queue sends after the current turn finishes. Steer sends immediately to guide the running turn."
        >
          <SettingsSelect
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
              'Show skills in the / menu',
              'Include skills in the / menu. Skills always appear when you type $.',
            ],
            [
              'markdownComposerPreview',
              'Formatted composer preview',
              'Show rendered Markdown above the message as you type.',
            ],
            [
              'collapseComposerOnScroll',
              'Collapse composer while reading',
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
          <SettingsSelect
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
          description="Choose how commands, edits and searches appear. Ctrl+O cycles through these views."
        >
          <SettingsSelect
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
          description="Include full inputs, output and raw events. Command summaries stay visible when off."
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
