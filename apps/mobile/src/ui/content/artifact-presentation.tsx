import { View } from 'react-native'
import type { ArtifactReference } from '@dovo/protocol'
import { Icon, type IconName } from '../controls/icon'
import { useTheme } from '../theme'

const presentation = {
  markdown: 'artifact',
  html: 'web',
  svg: 'preview',
  code: 'code',
} satisfies Record<ArtifactReference['format'], IconName>

export function ArtifactFormatIcon({
  format,
  large = false,
}: {
  format: ArtifactReference['format']
  large?: boolean
}) {
  const { colors } = useTheme()
  const icon = presentation[format]
  const color = {
    markdown: colors.warning,
    html: colors.syntaxFunction,
    svg: colors.syntaxKeyword,
    code: colors.success,
  }[format]
  return (
    <View
      style={{
        width: large ? 64 : 44,
        height: large ? 64 : 44,
        borderRadius: large ? 16 : 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: `${color}12`,
      }}
    >
      <Icon name={icon} color={color} size={large ? 28 : 22} />
    </View>
  )
}
