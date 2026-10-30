import { projectIcon, projectIconColor, projectIconInitials, type Repository } from '@dovo/protocol'
import { Image, View } from 'react-native'
import { Text } from '../../ui/content/text'

export function ProjectIcon({ repository, size = 20 }: { repository: Repository; size?: number }) {
  const icon = projectIcon(repository)
  return icon ? (
    <Image source={{ uri: icon }} style={{ width: size, height: size, borderRadius: 4 }} />
  ) : (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: 4,
        backgroundColor: projectIconColor(repository),
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: '#fff', fontSize: Math.max(9, size * 0.4), fontWeight: '700' }}>
        {projectIconInitials(repository)}
      </Text>
    </View>
  )
}
