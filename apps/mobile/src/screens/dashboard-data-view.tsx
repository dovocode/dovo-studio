import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { ScrollView, View } from 'react-native'
import Svg, { Path, Polygon, Polyline } from 'react-native-svg'
import { Text } from '../ui/content/text'
import { useTheme } from '../ui/theme'
import type { StudioDataPanel } from '@dovo/protocol'
import { dashboardDataRows, dashboardLinePlot, dashboardPanelValue } from '@dovo/studio-core'

export function DataView({
  value,
  chart,
  panels,
}: {
  value: unknown
  chart: StudioDataPanel['chart']
  panels?: readonly StudioDataPanel[]
}) {
  const uiText = useInterfaceText()
  const { colors } = useTheme()
  if (panels) return <DataGrid value={value} panels={panels} />
  if (chart === 'number')
    return (
      <Text style={{ fontSize: 30, fontWeight: '600', fontVariant: ['tabular-nums'] }}>
        {typeof value === 'number' ? value : uiText('Select a numeric field')}
      </Text>
    )
  if (chart === 'line') {
    const plot = dashboardLinePlot(value)
    if (!plot)
      return (
        <Text>
          {uiText('Select an array with at least two numbers or objects with a numeric value.')}
        </Text>
      )
    const { min, max, latest, points } = plot
    return (
      <>
        <Svg
          width="100%"
          height={120}
          viewBox="0 0 320 120"
          accessibilityLabel={uiText('Line graph, range {min} to {max}', { min, max })}
        >
          <Path d="M5 115H315 M5 60H315 M5 5H315" fill="none" stroke={colors.border} />
          <Polygon points={`5,115 ${points} 315,115`} fill={colors.accent} opacity={0.08} />
          <Polyline
            points={points}
            fill="none"
            stroke={colors.accent}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </Svg>
        <Text>{uiText('Latest {latest} · Range {min} to {max}', { latest, min, max })}</Text>
      </>
    )
  }
  const { columns, rows } = dashboardDataRows(value)
  return (
    <ScrollView horizontal>
      <View>
        {[columns, ...rows].map((row, index) => (
          <View
            key={index}
            style={{ flexDirection: 'row', borderBottomWidth: 1, borderColor: colors.border }}
          >
            {row.map((cell, i) => (
              <Text
                key={columns[i]}
                style={{ width: 128, padding: 6, fontWeight: index === 0 ? '600' : '400' }}
              >
                {cell}
              </Text>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  )
}

export function DataGrid({
  value,
  panels,
}: {
  value: unknown
  panels: readonly StudioDataPanel[]
}) {
  const uiText = useInterfaceText()
  const { colors } = useTheme()
  if (value === undefined) return <Text>{uiText('Refresh data to see these displays.')}</Text>
  return (
    <View style={{ gap: 8 }}>
      {panels.map((panel, index) => {
        const selected = dashboardPanelValue(value, panel.pointer)
        return (
          <View
            key={index}
            style={{
              gap: 6,
              padding: 12,
              borderRadius: 12,
              borderWidth: 1,
              backgroundColor: colors.surface,
              borderColor: colors.border,
            }}
          >
            <Text
              accessibilityRole="header"
              style={{ color: colors.muted, fontSize: 13, fontWeight: '600' }}
            >
              {panel.title}
            </Text>
            {selected === undefined ? (
              <Text>{uiText('Field unavailable')}</Text>
            ) : (
              <DataView value={selected} chart={panel.chart} />
            )}
          </View>
        )
      })}
    </View>
  )
}
