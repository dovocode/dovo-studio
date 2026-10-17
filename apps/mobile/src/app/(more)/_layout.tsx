import { Stack } from 'expo-router'

export const unstable_settings = { initialRouteName: 'settings' }

export default function MoreLayout() {
  return <Stack screenOptions={{ headerShown: false, animation: 'none' }} />
}
