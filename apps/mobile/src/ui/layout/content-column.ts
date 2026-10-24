import type { ViewStyle } from 'react-native'

// Width constraints follow the current window, including iPad Split View and rotation.
// Keep scroll views full-width so their indicators and gestures stay at the window edge.
export const contentColumn = {
  conversation: { width: '100%', maxWidth: 768, alignSelf: 'center' },
  collection: { width: '100%', maxWidth: 1024, alignSelf: 'center' },
  form: { width: '100%', maxWidth: 768, alignSelf: 'center' },
} satisfies Record<string, ViewStyle>
