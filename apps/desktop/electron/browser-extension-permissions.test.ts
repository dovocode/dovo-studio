import { expect, it, vi } from 'vite-plus/test'
import { attachExtensionPermissionChecks, webOriginCovered } from './browser-extension-permissions'

it.each([
  ['https://*/*', 'https://account.proton.me/*', true],
  ['https://*/*', 'https://pass.proton.me/path', true],
  ['*://*/*', 'http://computer.lan/*', true],
  ['https://*.proton.me/*', 'https://proton.me/*', true],
  ['https://*.proton.me/*', 'https://account.proton.me/*', true],
  ['https://*.proton.me/*', 'https://*.account.proton.me/*', true],
  ['https://*.proton.me/*', 'https://evilproton.me/*', false],
  ['https://account.proton.me/*', 'https://*.proton.me/*', false],
  ['https://*/*', '*://account.proton.me/*', false],
  ['http://*/*', 'https://account.proton.me/*', false],
  ['<all_urls>', 'file:///secret', false],
  ['https://*/*', '<all_urls>', false],
  ['<all_urls>', 'https://account.proton.me/*', true],
])('compares web grants %s against %s', (grant, request, covered) => {
  expect(webOriginCovered(grant, request)).toBe(covered)
})
it('checks current per-extension grants without granting permissions', () => {
  let check: ((event: { extension: { id: string } }, request: unknown) => boolean) | undefined
  const getAll = vi.fn<
    (event: {
      extension: { id: string }
    }) => { permissions: string[]; origins: string[] } | undefined
  >(({ extension }) =>
    extension.id === 'one' ? { permissions: ['storage'], origins: ['https://*/*'] } : undefined,
  )
  attachExtensionPermissionChecks({
    ctx: {
      router: {
        apiHandler: () => (name: string, handler: typeof check) => {
          expect(name).toBe('permissions.contains')
          check = handler
        },
      },
    },
    api: { permissions: { getAll } },
  })
  expect(
    check?.(
      { extension: { id: 'one' } },
      { origins: ['https://account.proton.me/*'], permissions: ['storage'] },
    ),
  ).toBe(true)
  expect(check?.({ extension: { id: 'one' } }, { permissions: ['nativeMessaging'] })).toBe(false)
  expect(
    check?.({ extension: { id: 'other' } }, { origins: ['https://account.proton.me/*'] }),
  ).toBe(false)
  expect(check?.({ extension: { id: 'one' } }, { origins: ['file:///secret'] })).toBe(false)
  expect(check?.({ extension: { id: 'one' } }, { origins: 123 })).toBe(false)
})
