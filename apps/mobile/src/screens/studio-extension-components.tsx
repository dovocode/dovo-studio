import { useSettingsDraft } from '../runtime/preferences/settings-target'
import { MobileDataSource } from './studio-data-source'
import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { useState } from 'react'
import { Pressable, View } from 'react-native'
import Svg, { Circle, Rect, Text as SvgText } from 'react-native-svg'
import type { ExtensionContribution, ExtensionViewNode, StudioExtensionEntry } from '@dovo/protocol'
import {
  ExtensionComponentBoundary,
  extensionViewText,
  useExtensionView,
  type ExtensionViewState,
  type SaveExtensionSettings,
} from '@dovo/studio-core'
import { useRuntime } from '../runtime/connection/provider'
import { EmptyState } from '../ui/content/empty-state'
import { Text } from '../ui/content/text'
import { Action } from '../ui/controls/action'
import { Choice } from '../ui/controls/choice'
import { Field } from '../ui/controls/field'
import { Icon } from '../ui/controls/icon'
import { Switch } from '../ui/controls/switch'
import { Sheet } from '../ui/layout/sheet'
import { Surface } from '../ui/layout/surface'
import { useTheme } from '../ui/theme'
import { DataGrid, DataView } from './dashboard-data-view'

const stack = { gap: 8 }
const row = { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 } as const

export function ExtensionSettingsConflicts({
  conflicts,
  resolveConflicts,
  busy,
}: Pick<ExtensionViewState, 'conflicts' | 'resolveConflicts' | 'busy'>) {
  const uiText = useInterfaceText()
  if (!conflicts.length) return null
  return (
    <Surface style={{ ...stack, padding: 12, borderRadius: 10 }}>
      <Text accessibilityRole="alert">{uiText('Some settings changed on another client.')}</Text>
      {conflicts.map(({ id, title, saved }) => (
        <Text key={id}>
          {uiText('{title}. Saved value: {value}', {
            title,
            value: extensionViewText(saved) || uiText('Empty'),
          })}
        </Text>
      ))}
      <View style={row}>
        <Action
          secondary
          label={uiText('Use saved values')}
          disabled={busy}
          onPress={() => resolveConflicts('saved')}
        />
        <Action
          secondary
          label={uiText('Keep my edits')}
          disabled={busy}
          onPress={() => resolveConflicts('local')}
        />
      </View>
    </Surface>
  )
}

export function ExtensionComponents({
  entry,
  contribution,
  save,
}: {
  entry: StudioExtensionEntry
  contribution: Extract<ExtensionContribution, { kind: 'view' }>
  save: SaveExtensionSettings
}) {
  const uiText = useInterfaceText()
  const { read, connected } = useRuntime()
  const state = useExtensionView(contribution.view, entry, read, connected, save)
  useSettingsDraft(state.dirty, state.settingsSaving)
  return (
    <ExtensionComponentBoundary
      fallback={
        <Text accessibilityRole="alert">{uiText('This extension view could not load.')}</Text>
      }
    >
      <View style={stack}>
        {state.implicitSources.map((source) => (
          <ViewSource key={source.id} id={source.id} state={state} />
        ))}
        <Node id={contribution.view.root} state={state} />
        <ExtensionSettingsConflicts {...state} />
        {state.dirty && (
          <View style={row}>
            <Action
              label={uiText('Save extension settings')}
              disabled={state.disabled || state.conflicts.length > 0}
              onPress={() => void state.save()}
            />
            <Action
              secondary
              label={uiText('Discard edits')}
              disabled={state.busy}
              onPress={state.discard}
            />
          </View>
        )}
        {state.busy && <Text accessibilityLiveRegion="polite">{uiText('Working…')}</Text>}
        {state.error && <Text accessibilityRole="alert">{state.error}</Text>}
      </View>
    </ExtensionComponentBoundary>
  )
}

function ViewSource({ id, state }: { id: string; state: ExtensionViewState }) {
  const source = state.sources.find((item) => item.id === id)
  if (!source) return null
  return (
    <MobileDataSource
      key={JSON.stringify(source)}
      source={source}
      read={() => state.readSource(id)}
      onData={(value) => state.setResult(id, value)}
    />
  )
}

function Node({ id, state }: { id: string; state: ExtensionViewState }) {
  const uiText = useInterfaceText()
  const [selected, select] = useState('')
  const [open, setOpen] = useState(false)
  const [standard, setStandard] = useState(false)
  const { colors } = useTheme()
  const node = state.nodes.get(id)
  if (!node) return null
  const child = (id: string) => <Node key={id} id={id} state={state} />
  const heading = (label: string) => (
    <Text accessibilityRole="header" style={{ fontWeight: '600' }}>
      {label}
    </Text>
  )
  switch (node.kind) {
    case 'stack':
      return <View style={stack}>{node.children.map(child)}</View>
    case 'row':
      return <View style={row}>{node.children.map(child)}</View>
    case 'card':
      return (
        <Surface style={{ ...stack, padding: 12, borderRadius: 10 }}>
          {node.label && heading(node.label)}
          {node.children.map(child)}
        </Surface>
      )
    case 'separator':
      return <View style={{ height: 1, backgroundColor: colors.border }} />
    case 'text':
      return (
        <Text
          accessibilityRole={node.style === 'heading' ? 'header' : undefined}
          style={{
            color: node.style === 'muted' ? colors.muted : colors.text,
            fontWeight: node.style === 'heading' ? '600' : '400',
            fontFamily: node.style === 'code' ? 'monospace' : undefined,
          }}
        >
          {extensionViewText(state.get(node.value))}
        </Text>
      )
    case 'badge':
      return (
        <Surface
          tinted
          style={{
            alignSelf: 'flex-start',
            paddingHorizontal: 8,
            paddingVertical: 4,
            borderRadius: 12,
          }}
        >
          <Text>{extensionViewText(state.get(node.value))}</Text>
        </Surface>
      )
    case 'status':
      return (
        <Text
          accessibilityLiveRegion="polite"
          style={{ color: diagramTones(colors)[node.tone ?? 'normal'] }}
        >
          {extensionViewText(state.get(node.value))}
        </Text>
      )
    case 'empty':
      return <EmptyState icon="stack" title={node.label} description={node.description} />
    case 'button':
      return (
        <Action
          label={node.label}
          disabled={state.actionsDisabled}
          onPress={() => void state.run(node.action)}
        />
      )
    case 'menu':
      return (
        <>
          <Action
            secondary
            label={node.label}
            disabled={state.actionsDisabled}
            onPress={() => setOpen(true)}
          />
          {open && (
            <Sheet title={node.label} onClose={() => setOpen(false)}>
              {node.items.map((item, index) => (
                <Action
                  key={index}
                  secondary
                  label={item.label}
                  disabled={state.actionsDisabled}
                  onPress={() => {
                    setOpen(false)
                    void state.run(item.action)
                  }}
                />
              ))}
            </Sheet>
          )}
        </>
      )
    case 'input':
    case 'textarea':
      return (
        <Field
          label={node.label}
          editable={!state.disabled}
          multiline={node.kind === 'textarea'}
          maxLength={4096}
          value={extensionViewText(state.getSetting(node.setting))}
          onChangeText={(value) => state.edit(node.setting, value)}
        />
      )
    case 'switch':
      return (
        <View style={row}>
          <Text>{node.label}</Text>
          <Switch
            accessibilityLabel={node.label}
            disabled={state.disabled}
            value={state.getSetting(node.setting) === true}
            onValueChange={(value) => state.edit(node.setting, value)}
          />
        </View>
      )
    case 'checkbox': {
      const checked = state.getSetting(node.setting) === true
      return (
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked, disabled: state.disabled }}
          disabled={state.disabled}
          style={{ ...row, minHeight: 44 }}
          onPress={() => state.edit(node.setting, !checked)}
        >
          <Surface
            tinted={checked}
            style={{
              width: 20,
              height: 20,
              borderRadius: 4,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {checked && <Icon name="check" size={16} />}
          </Surface>
          <Text>{node.label}</Text>
        </Pressable>
      )
    }
    case 'select':
      return (
        <Choice
          label={node.label}
          value={extensionViewText(state.getSetting(node.setting))}
          disabled={state.disabled}
          items={node.items.map((item) => ({ id: item.value, name: item.label }))}
          onChange={(value) => state.edit(node.setting, value)}
        />
      )
    case 'tabs': {
      const active = selected || node.items[0]?.child
      return (
        active && (
          <View style={stack}>
            <Choice
              label={node.label}
              value={active}
              items={node.items.map((item) => ({ id: item.child, name: item.label }))}
              onChange={select}
            />
            {child(active)}
          </View>
        )
      )
    }
    case 'disclosure':
      return (
        <View style={stack}>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: open }}
            style={{ ...row, minHeight: 44 }}
            onPress={() => setOpen(!open)}
          >
            <Icon name={open ? 'down' : 'next'} size={16} />
            <Text>{node.label}</Text>
          </Pressable>
          {open && child(node.child)}
        </View>
      )
    case 'dialog':
      return (
        <>
          <Action secondary label={node.label} onPress={() => setOpen(true)} />
          {open && (
            <Sheet presentation="dialog" title={node.label} onClose={() => setOpen(false)}>
              {child(node.child)}
            </Sheet>
          )}
        </>
      )
    case 'data-grid':
      return <DataGrid value={state.get(node.value)} panels={node.panels} />
    case 'data-source':
      return <ViewSource id={node.source} state={state} />
    case 'table':
    case 'chart':
      return (
        <View style={stack}>
          {heading(node.label)}
          <DataView
            value={state.get(node.value)}
            chart={node.kind === 'chart' ? 'line' : 'table'}
          />
        </View>
      )
    case 'metric':
      return (
        <View>
          {heading(node.label)}
          <Text style={{ fontSize: 24 }}>{extensionViewText(state.get(node.value))}</Text>
        </View>
      )
    case 'custom': {
      const fallback = child(node.fallback)
      if (node.component.type !== 'diagram') return fallback
      return (
        <View style={stack}>
          {standard ? (
            fallback
          ) : (
            <ExtensionComponentBoundary fallback={fallback}>
              <Diagram node={node} state={state} />
            </ExtensionComponentBoundary>
          )}
          <Action
            secondary
            label={standard ? uiText('Show custom component') : uiText('Show Studio components')}
            onPress={() => setStandard(!standard)}
          />
        </View>
      )
    }
  }
}

function diagramTones(colors: ReturnType<typeof useTheme>['colors']) {
  return { normal: colors.text, muted: colors.muted, accent: colors.accent, danger: colors.error }
}

function Diagram({
  node,
  state,
}: {
  node: Extract<ExtensionViewNode, { kind: 'custom' }>
  state: ExtensionViewState
}) {
  const { colors } = useTheme()
  const tones = diagramTones(colors)
  return (
    <>
      <Svg
        width="100%"
        height={192}
        viewBox="0 0 1000 1000"
        accessible
        accessibilityRole="image"
        accessibilityLabel={node.label}
      >
        {node.component.shapes?.map((shape, index) => {
          const fill = tones[shape.tone]
          if (shape.kind === 'rect')
            return (
              <Rect
                key={index}
                fill={fill}
                x={shape.x}
                y={shape.y}
                width={shape.width}
                height={shape.height}
              />
            )
          if (shape.kind === 'circle')
            return <Circle key={index} fill={fill} cx={shape.x} cy={shape.y} r={shape.radius} />
          return (
            <SvgText key={index} fill={fill} x={shape.x} y={shape.y} fontSize={68}>
              {extensionViewText(state.get(shape.value)).slice(0, 100)}
            </SvgText>
          )
        })}
      </Svg>
      <View style={row}>
        {node.component.actions?.map((item, index) => (
          <Action
            key={index}
            label={item.label}
            disabled={state.actionsDisabled}
            onPress={() => void state.run(item.action)}
          />
        ))}
      </View>
    </>
  )
}
