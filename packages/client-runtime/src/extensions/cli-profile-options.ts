type Profile = { id: string; name: string; username?: string; active?: boolean }

/** Discovery never replaces an explicitly selected profile, including one currently unavailable. */
export function cliProfileOptions(profiles: Profile[], selected: string, defaultLabel: string) {
  const options = new Map<string, { id: string; name: string }>()
  options.set('', { id: '', name: defaultLabel })
  for (const profile of profiles) {
    options.set(profile.id, {
      id: profile.id,
      name: `${profile.name}${profile.username && profile.username !== profile.name ? ` · ${profile.username}` : ''}${profile.active ? ' · Active' : ''}`,
    })
  }
  if (selected && !options.has(selected))
    options.set(selected, { id: selected, name: `${selected} · Current selection` })
  return [...options.values()]
}
