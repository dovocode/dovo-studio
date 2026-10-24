import { useState } from 'react'
import { Pressable, Switch as NativeSwitch, View } from 'react-native'
import type { StudioThemeId, StudioThemeMode } from '@dovo/studio-core/themes'
import { Action } from '../ui/controls/action'
import { Choice } from '../ui/controls/choice'
import { Field, SearchField } from '../ui/controls/field'
import { Pill } from '../ui/controls/pill'
import { Switch } from '../ui/controls/switch'
import { Text } from '../ui/content/text'
import { createMobileTheme, MobileThemeContext, useTheme } from '../ui/theme'
import { MobileCatalogProviders } from './providers'

/** Shared local-only control specimen for the browser catalog and native Storybook. */
export function MobileControlsExample({
  palette = 'dovo',
  mode = 'dark',
}: {
  palette?: StudioThemeId
  mode?: StudioThemeMode
}) {
  const theme = createMobileTheme(palette, mode)
  return (
    <MobileCatalogProviders>
      <MobileThemeContext.Provider value={theme}>
        <ControlsContent />
      </MobileThemeContext.Provider>
    </MobileCatalogProviders>
  )
}

function ControlsContent() {
  const [project, setProject] = useState('website')
  const [search, setSearch] = useState('')
  const [name, setName] = useState('Dominic')
  const [enabled, setEnabled] = useState(true)
  const [notifications, setNotifications] = useState(false)
  const [error, setError] = useState(false)
  const [count, setCount] = useState(0)
  const [saved, setSaved] = useState(false)
  const theme = useTheme()
  const { colors, styles } = theme

  return (
    <View style={[styles.screen, { padding: 16, gap: 16 }]}>
      <View style={{ gap: 4 }}>
        <Text accessibilityRole="header" style={styles.title}>
          Mobile controls
        </Text>
        <Text style={styles.muted}>
          Production controls with local state. Change the fields, choose a project, and toggle the
          switches to inspect feedback and focus behavior.
        </Text>
      </View>

      <View style={[styles.card, { gap: 12 }]}>
        <Text accessibilityRole="header" style={styles.text}>
          Fields and choices
        </Text>
        <Field
          label="Workspace name"
          value={name}
          onChangeText={(value) => {
            setName(value)
            setError(false)
          }}
          placeholder="Name this workspace"
          hint="Stored in this preview only."
          error={error ? 'Use at least 3 characters.' : undefined}
        />
        <SearchField
          label="Search projects"
          value={search}
          onChangeText={setSearch}
          placeholder="Filter available projects"
        />
        <Choice
          label="Project"
          value={project}
          onChange={setProject}
          row
          items={[
            { id: 'website', name: 'Website redesign' },
            { id: 'mobile', name: 'Mobile app' },
            { id: 'studio', name: 'Studio tooling' },
          ].filter((item) => item.name.toLowerCase().includes(search.toLowerCase()))}
        />
      </View>

      <View style={[styles.card, { gap: 10 }]}>
        <Text accessibilityRole="header" style={styles.text}>
          Switches and actions
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.text}>Automatic updates</Text>
            <Text style={styles.muted}>Keep the preview current in the background.</Text>
          </View>
          <Switch
            accessibilityLabel="Automatic updates"
            value={enabled}
            onValueChange={setEnabled}
          />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.text}>Completion notices</Text>
            <Text style={styles.muted}>Show a notice when a task needs attention.</Text>
          </View>
          <NativeSwitch
            accessibilityLabel="Completion notices"
            value={notifications}
            onValueChange={setNotifications}
          />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <Action label="Save preview" onPress={() => setSaved(true)} />
          <Action label="Test connection" onPress={() => setSaved(true)} variant="outline" />
          <Action label="Agent & model" onPress={() => setError(true)} secondary />
          <Pill
            label={count ? `Preview updated ${count}` : 'Preview status'}
            icon="info"
            onPress={() => setCount((value) => value + 1)}
            accessibilityHint="Updates a local preview counter."
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear preview status"
            onPress={() => {
              setSaved(false)
              setError(name.trim().length < 3)
            }}
            style={({ pressed }) => ({
              minHeight: 44,
              justifyContent: 'center',
              paddingHorizontal: 12,
              borderRadius: 10,
              backgroundColor: pressed ? colors.selection : 'transparent',
            })}
          >
            <Text style={{ color: colors.accent }}>Reset feedback</Text>
          </Pressable>
        </View>
        {!!saved && (
          <Text accessibilityRole="status" style={styles.muted}>
            Saved in this preview.
          </Text>
        )}
      </View>
    </View>
  )
}
