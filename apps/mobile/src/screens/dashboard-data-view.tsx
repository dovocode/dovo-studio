import { useInterfaceText } from '@dovo/studio-core/interface-language'
import { ScrollView, View } from 'react-native'
import Svg, { Polyline } from 'react-native-svg'
import { Text } from '../ui/content/text'
import { useTheme } from '../ui/theme'
import { dashboardDataRows, dashboardLinePlot } from '@dovo/studio-core'

export function DataView({ value, chart }: { value: unknown; chart: 'line' | 'table' | 'number' }) {
  const uiText = useInterfaceText()
  const { colors } = useTheme()
  if (chart === 'number')
    return (
      <Text style={{ fontSize: 24 }}>
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
          <Polyline points={points} fill="none" stroke={colors.accent} strokeWidth={2} />
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
          <View key={index} style={{ flexDirection: 'row' }}>
            {row.map((cell, i) => (
              <Text
                key={columns[i]}
                style={{ width: 128, padding: 4, fontWeight: index === 0 ? '600' : '400' }}
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
