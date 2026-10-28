import { useAppPreferences, useRemoteBrowserProfiles, useWorkspace } from '@dovo/studio-core'
import type { BrowserTab } from './shared-browser-tabs'
import { isPrivateBrowserProfile } from '@dovo/protocol'

/** Resolve each tab against its own computer, including tabs on inactive runtimes. */
export function useBrowserProfileDetails(tab: BrowserTab) {
  const { runtimes } = useWorkspace()
  const preferences = useAppPreferences()
  const owner = runtimes.find((runtime) => runtime.profile.id === tab.runtimeId)
  const remote = useRemoteBrowserProfiles(owner?.profile, tab.kind === 'remote' && !!owner)
  const profiles =
    tab.kind === 'web' ? preferences.browserProfiles : owner ? remote.profiles : undefined
  const profile = profiles?.find((profile) => profile.id === tab.profileId)
  return {
    emoji: isPrivateBrowserProfile(tab.profileId) ? '🔒' : profile?.emoji,
    name: isPrivateBrowserProfile(tab.profileId)
      ? 'Private · temporary'
      : (profile?.name ??
        (tab.profileId === 'default'
          ? 'Default'
          : remote.loading && tab.kind === 'remote' && owner
            ? 'Loading profile…'
            : 'Unavailable profile')),
  }
}

export function useBrowserProfileName(tab: BrowserTab) {
  return useBrowserProfileDetails(tab).name
}

export function BrowserProfileLabel({ tab }: { tab: BrowserTab }) {
  return useBrowserProfileName(tab)
}
