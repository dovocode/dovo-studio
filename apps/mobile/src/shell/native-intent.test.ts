import { expect, it } from 'vite-plus/test'
import { redirectSystemPath } from '../app/+native-intent'
it('opens pairing in Computers without making an automatic trust decision', () => {
  const params = new URLSearchParams({
    address: 'http://100.90.80.70:8787',
    code: '00112233',
    expiresAt: new Date(Date.now() + 120000).toISOString(),
  })
  for (const path of [`dovo://pair?${params}`, `/pair?${params}`]) {
    expect(redirectSystemPath({ path, initial: true })).toBe(`/settings/devices?${params}`)
  }
  expect(redirectSystemPath({ path: 'dovo://pair?code=expired', initial: false })).toContain(
    '/settings/devices?pairingError=',
  )
  expect(redirectSystemPath({ path: 'dovo://task?text=hello', initial: true })).toBe('/')
})

it('opens the launcher from cold and warm shortcuts and preserves an encoded prompt', () => {
  for (const initial of [true, false]) {
    for (const path of ['dovo://launch', '/launch']) {
      expect(redirectSystemPath({ path, initial })).toBe('/launch')
    }
    const query = new URLSearchParams({ text: 'Fix login & keep favorites' }).toString()
    expect(redirectSystemPath({ path: 'dovo://launch?' + query, initial })).toBe('/launch?' + query)
    expect(redirectSystemPath({ path: '/launch?' + query, initial })).toBe('/launch?' + query)
    expect(redirectSystemPath({ path: 'dovo://launcher', initial })).toBe('dovo://launcher')
  }
})

it('opens the normal workbench for cold and warm share-sheet launches', () => {
  for (const initial of [true, false]) {
    for (const path of ['dovo://expo-sharing', '/expo-sharing']) {
      expect(redirectSystemPath({ path, initial })).toBe('/')
    }
  }
})
