export function isTeamsBrowserUrl(url: URL) {
  return ['teams.microsoft.com', 'teams.cloud.microsoft', 'teams.live.com'].includes(url.hostname)
}

export function documentPipDisallowsReturn(features: string, opener: URL) {
  return isTeamsBrowserUrl(opener) || /(?:^|,)dovo-disallow-return=1(?:,|$)/.test(features)
}
