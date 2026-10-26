import { useAppPreferences, useRemoteBrowserProfiles, useWorkspace } from '@dovo/studio-core'
import type { BrowserTab } from './shared-browser-tabs'
import { isPrivateBrowserProfile } from '@dovo/protocol'

/** Resolve each tab against its own computer, including tabs on inactive runtimes. */
export function useBrowserProfileName(tab: BrowserTab) {
  const { runtimes } = useWorkspace()
  const preferences = useAppPreferences()
  const owner = runtimes.find((runtime) => runtime.profile.id === tab.runtimeId)
  const remote = useRemoteBrowserProfiles(owner?.profile, tab.kind === 'remote' && !!owner)
  const profiles =
    tab.kind === 'web' ? preferences.browserProfiles : owner ? remote.profiles : undefined
  return isPrivateBrowserProfile(tab.profileId)
    ? 'Private · temporary'
    : (profiles?.find((profile) => profile.id === tab.profileId)?.name ??
        (tab.profileId === 'default'
          ? 'Default'
          : remote.loading && tab.kind === 'remote' && owner
            ? 'Loading profile…'
            : 'Unavailable profile'))
}

export function BrowserProfileLabel({ tab }: { tab: BrowserTab }) {
  return useBrowserProfileName(tab)
}
