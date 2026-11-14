import { InterfaceText, useInterfaceText } from '@dovo/studio-core/interface-language'
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
import { useGlassAccessibility } from '../ui/use-glass-accessibility'

/** Shared local-only control specimen for the browser catalog and native Storybook. */
export function MobileControlsExample({
  palette = 'dovo',
  mode = 'dark',
}: {
  palette?: StudioThemeId
  mode?: StudioThemeMode
}) {
  const accessibility = useGlassAccessibility()
  const theme = createMobileTheme(palette, mode, undefined, accessibility)
  return (
    <MobileCatalogProviders>
      <MobileThemeContext.Provider value={theme}>
        <ControlsContent />
      </MobileThemeContext.Provider>
    </MobileCatalogProviders>
  )
}

function ControlsContent() {
  const uiText = useInterfaceText()

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
          <InterfaceText>{'Mobile controls'}</InterfaceText>
        </Text>
        <Text style={styles.muted}>
          <InterfaceText>
            {
              'Production controls with local state. Change the fields, choose a project, and toggle the switches to inspect feedback and focus behavior.'
            }
          </InterfaceText>
        </Text>
      </View>

      <View style={[styles.card, { gap: 12 }]}>
        <Text accessibilityRole="header" style={styles.text}>
          <InterfaceText>{'Fields and choices'}</InterfaceText>
        </Text>
        <Field
          label={uiText('Workspace name')}
          value={name}
          onChangeText={(value) => {
            setName(value)
            setError(false)
          }}
          placeholder={uiText('Name this workspace')}
          hint={uiText('Stored in this preview only.')}
          error={error ? 'Use at least 3 characters.' : undefined}
        />
        <SearchField
          label={uiText('Search projects')}
          value={search}
          onChangeText={setSearch}
          placeholder={uiText('Filter available projects')}
        />
        <Choice
          label={uiText('Project')}
          value={project}
          onChange={setProject}
          row
          items={[
            { id: 'website', name: uiText('Website redesign') },
            { id: 'mobile', name: uiText('Mobile app') },
            { id: 'studio', name: uiText('Studio tooling') },
          ].filter((item) => item.name.toLowerCase().includes(search.toLowerCase()))}
        />
      </View>

      <View style={[styles.card, { gap: 10 }]}>
        <Text accessibilityRole="header" style={styles.text}>
          <InterfaceText>{'Switches and actions'}</InterfaceText>
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.text}>
              <InterfaceText>{'Automatic updates'}</InterfaceText>
            </Text>
            <Text style={styles.muted}>
              <InterfaceText>{'Keep the preview current in the background.'}</InterfaceText>
            </Text>
          </View>
          <Switch
            accessibilityLabel={uiText('Automatic updates')}
            value={enabled}
            onValueChange={setEnabled}
          />
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.text}>
              <InterfaceText>{'Completion notices'}</InterfaceText>
            </Text>
            <Text style={styles.muted}>
              <InterfaceText>{'Show a notice when a task needs attention.'}</InterfaceText>
            </Text>
          </View>
          <NativeSwitch
            accessibilityLabel={uiText('Completion notices')}
            value={notifications}
            onValueChange={setNotifications}
          />
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
          <Action label={uiText('Save preview')} onPress={() => setSaved(true)} />
          <Action
            label={uiText('Test connection')}
            onPress={() => setSaved(true)}
            variant="outline"
          />
          <Action label={uiText('Agent & model')} onPress={() => setError(true)} secondary />
          <Pill
            label={
              count
                ? uiText('Preview updated {value0}', { value0: count })
                : uiText('Preview status')
            }
            icon="info"
            onPress={() => setCount((value) => value + 1)}
            accessibilityHint={uiText('Updates a local preview counter.')}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={uiText('Clear preview status')}
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
            <Text style={{ color: colors.accent }}>
              <InterfaceText>{'Reset feedback'}</InterfaceText>
            </Text>
          </Pressable>
        </View>
        {!!saved && (
          <Text accessibilityRole="status" style={styles.muted}>
            <InterfaceText>{'Saved in this preview.'}</InterfaceText>
          </Text>
        )}
      </View>
    </View>
  )
}
