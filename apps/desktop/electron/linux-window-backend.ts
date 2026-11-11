/** XWayland provides the window placement and topmost controls that native Wayland lacks. */
export function useLinuxXWayland(
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
  explicitBackend: boolean,
) {
  return (
    platform === 'linux' &&
    !!environment.DISPLAY &&
    (!!environment.WAYLAND_DISPLAY || environment.XDG_SESSION_TYPE === 'wayland') &&
    !explicitBackend &&
    !environment.ELECTRON_OZONE_PLATFORM_HINT
  )
}
