import { expect, it } from 'vite-plus/test'
import { useLinuxXWayland } from './linux-window-backend'

it('uses XWayland on a Wayland desktop with an available X display', () => {
  expect(useLinuxXWayland('linux', { WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' }, false)).toBe(
    true,
  )
  expect(useLinuxXWayland('linux', { XDG_SESSION_TYPE: 'wayland', DISPLAY: ':0' }, false)).toBe(
    true,
  )
})

it('keeps explicit backends, pure Wayland, X11 and other platforms unchanged', () => {
  const environment = { WAYLAND_DISPLAY: 'wayland-0', DISPLAY: ':0' }
  expect(useLinuxXWayland('linux', environment, true)).toBe(false)
  expect(
    useLinuxXWayland('linux', { ...environment, ELECTRON_OZONE_PLATFORM_HINT: 'wayland' }, false),
  ).toBe(false)
  expect(useLinuxXWayland('linux', { WAYLAND_DISPLAY: 'wayland-0' }, false)).toBe(false)
  expect(useLinuxXWayland('linux', { DISPLAY: ':0', XDG_SESSION_TYPE: 'x11' }, false)).toBe(false)
  expect(useLinuxXWayland('darwin', environment, false)).toBe(false)
  expect(useLinuxXWayland('win32', environment, false)).toBe(false)
})
