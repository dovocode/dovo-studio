export function isLinuxWaylandSession(platform: NodeJS.Platform, environment: NodeJS.ProcessEnv) {
  return (
    platform === 'linux' &&
    (!!environment.WAYLAND_DISPLAY || environment.XDG_SESSION_TYPE === 'wayland')
  )
}

/** XWayland provides the window placement and topmost controls that native Wayland lacks. */
export function useLinuxXWayland(
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
  explicitBackend: boolean,
) {
  return (
    isLinuxWaylandSession(platform, environment) &&
    !!environment.DISPLAY &&
    !explicitBackend &&
    !environment.ELECTRON_OZONE_PLATFORM_HINT
  )
}
