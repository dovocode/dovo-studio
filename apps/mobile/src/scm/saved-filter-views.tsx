import { useState } from 'react'
import { View } from 'react-native'
import {
  randomUUID,
  saveFilterView,
  availableSavedFilterView,
  savedFilterSourceScope,
  type SavedFilterSource,
  type SavedFilterView,
  type SavedFilterValues,
} from '@dovo/protocol'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import {
  useMobilePreferences,
  updateMobilePreferences,
  readMobilePreferences,
  retryMobilePreferences,
} from '../runtime/preferences/app-preferences'
import { Action } from '../ui/controls/action'
import { Choice } from '../ui/controls/choice'
import { Field } from '../ui/controls/field'
import { Text } from '../ui/content/text'
import { useTheme } from '../ui/theme'

export function SavedFilterViews({
  kind,
  scope,
  sources,
  value,
  onApply,
}: {
  kind: SavedFilterView['kind']
  scope: string
  sources: readonly SavedFilterSource[]
  value: SavedFilterValues
  onApply: (filters: SavedFilterValues) => void
}) {
  const uiText = useInterfaceText()
  const { styles } = useTheme()
  const { savedFilterViews } = useMobilePreferences()
  const views = savedFilterViews.filter(
    (view) => view.kind === kind && availableSavedFilterView(view, scope, sources),
  )
  const [open, setOpen] = useState(false)
  const [id, setId] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const selected = views.find((view) => view.id === id)
  const save = async (view: SavedFilterView) => {
    if (busy) return
    setBusy(true)
    try {
      await retryMobilePreferences()
      if (view.filters.source && !savedFilterSourceScope(view.filters.source, sources))
        throw new Error('Choose an available source before saving a view.')
      updateMobilePreferences({
        savedFilterViews: saveFilterView(readMobilePreferences().savedFilterViews, {
          ...view,
          sourceScope: savedFilterSourceScope(view.filters.source, sources),
        }),
      })
      await retryMobilePreferences()
      setId(view.id)
      setName(view.name.trim())
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }
  return (
    <View style={{ gap: 6 }}>
      <Action
        secondary
        label={uiText(open ? 'Hide saved views' : 'Saved views')}
        onPress={() => setOpen(!open)}
      />
      {open && (
        <>
          <Choice
            disabled={busy}
            label={uiText('Saved view')}
            value={selected?.id ?? ''}
            items={[
              { id: '', name: uiText('Choose a saved view') },
              ...views.map((view) => ({ id: view.id, name: view.name })),
            ]}
            onChange={(id) => {
              const view = views.find((view) => view.id === id)
              setId(id)
              setName(view?.name ?? '')
              setError('')
              if (view) onApply(view.filters)
            }}
          />
          <Field label={uiText('View name')} maxLength={80} value={name} onChangeText={setName} />
          <Action
            secondary
            disabled={busy || !name.trim()}
            label={uiText('Save new view')}
            onPress={() => save({ id: randomUUID(), name, kind, scope, filters: value })}
          />
          {selected && (
            <>
              <Action
                secondary
                disabled={busy}
                label={uiText('Update filters')}
                onPress={() => save({ ...selected, filters: value })}
              />
              <Action
                secondary
                disabled={busy || !name.trim()}
                label={uiText('Rename')}
                onPress={() => save({ ...selected, name })}
              />
              <Action
                destructive
                secondary
                disabled={busy}
                label={uiText('Delete view')}
                onPress={async () => {
                  setBusy(true)
                  try {
                    await retryMobilePreferences()
                    updateMobilePreferences({
                      savedFilterViews: readMobilePreferences().savedFilterViews.filter(
                        (view) => view.id !== selected.id,
                      ),
                    })
                    await retryMobilePreferences()
                    setId('')
                    setName('')
                    setError('')
                  } catch (cause) {
                    setError(String(cause))
                  } finally {
                    setBusy(false)
                  }
                }}
              />
            </>
          )}
          {!!error && (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          )}
        </>
      )}
    </View>
  )
}
