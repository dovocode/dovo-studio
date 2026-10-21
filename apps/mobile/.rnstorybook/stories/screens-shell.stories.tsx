import type { Meta, StoryObj } from '@storybook/react-native'
import { ExpoRoot } from 'expo-router'
import { View } from 'react-native'
const context = require.context('./screens-shell-routes', true, /\.tsx$/)
function NativeShell({ location = '/' }: { location?: string }) {
  return (
    <View style={{ flex: 1 }}>
      <ExpoRoot key={location} context={context} location={location} />
    </View>
  )
}
const meta = {
  title: 'Dovo/Mobile/Native navigation',
  component: NativeShell,
  parameters: { layout: 'fullscreen' },
  args: { location: '/' },
} satisfies Meta<typeof NativeShell>
export default meta
type Story = StoryObj<typeof meta>
export const TasksTabsAndMenu: Story = {}
export const PullsTab: Story = { args: { location: '/pulls' } }
export const SettingsStack: Story = { args: { location: '/settings' } }
export const ProjectStack: Story = { args: { location: '/projects' } }
export const IssuesStack: Story = { args: { location: '/issues' } }
export const ArtifactsStack: Story = { args: { location: '/artifacts' } }
export const AppearanceStack: Story = { args: { location: '/settings/appearance' } }
