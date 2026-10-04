import { View } from 'react-native'
import type { ArtifactReference } from '@dovo/protocol'
import { Icon, type IconName } from '../controls/icon'

const presentation = {
  markdown: { icon: 'artifact', color: '#e7c681', background: '#e7c68112' },
  html: { icon: 'web', color: '#93c5fd', background: '#93c5fd12' },
  svg: { icon: 'preview', color: '#c4b5fd', background: '#c4b5fd12' },
  code: { icon: 'code', color: '#8ad5b0', background: '#8ad5b012' },
} satisfies Record<
  ArtifactReference['format'],
  { icon: IconName; color: string; background: string }
>

export function ArtifactFormatIcon({
  format,
  large = false,
}: {
  format: ArtifactReference['format']
  large?: boolean
}) {
  const { icon, color, background } = presentation[format]
  return (
    <View
      style={{
        width: large ? 64 : 44,
        height: large ? 64 : 44,
        borderRadius: large ? 16 : 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: background,
      }}
    >
      <Icon name={icon} color={color} size={large ? 28 : 22} />
    </View>
  )
}
