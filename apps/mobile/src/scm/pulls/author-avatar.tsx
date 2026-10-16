import { useState } from 'react'
import { Image, View } from 'react-native'
import { Text } from '../../ui/content/text'
import { useTheme } from '../../ui/theme'

export function AuthorAvatar({ author, url }: { author: string; url?: string }) {
  const { colors } = useTheme()
  const [failedUrl, setFailedUrl] = useState<string>()
  const frame = { width: 20, height: 20, borderRadius: 10 }
  return url && url !== failedUrl ? (
    <Image
      accessibilityLabel={`${author}'s avatar`}
      source={{ uri: url }}
      onError={() => setFailedUrl(url)}
      style={frame}
    />
  ) : (
    <View
      style={{
        ...frame,
        backgroundColor: colors.elevated,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: colors.muted, fontSize: 11, fontWeight: '600' }}>
        {author.slice(0, 1).toUpperCase()}
      </Text>
    </View>
  )
}
