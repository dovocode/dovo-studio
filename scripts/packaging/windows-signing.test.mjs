import { test } from 'node:test'
import assert from 'node:assert/strict'
import { windowsSigningOptions } from './windows-signing.mjs'

const environment = {
  AZURE_SIGNING_ENDPOINT: 'https://weu.codesigning.azure.net/',
  AZURE_SIGNING_ACCOUNT: 'studio',
  AZURE_SIGNING_PROFILE: 'public',
  AZURE_SIGNING_PUBLISHER: 'Verified Publisher',
}

await test('signing requires every resource identifier and the publisher used for update verification', () => {
  for (const name of Object.keys(environment)) {
    assert.throws(() => windowsSigningOptions({ ...environment, [name]: '' }), new RegExp(name))
  }
  assert.deepEqual(windowsSigningOptions(environment), {
    endpoint: environment.AZURE_SIGNING_ENDPOINT,
    codeSigningAccountName: 'studio',
    certificateProfileName: 'public',
    publisherName: 'Verified Publisher',
  })
})

await test('signing rejects insecure and non-Azure service endpoints', () => {
  for (const endpoint of [
    'http://weu.codesigning.azure.net/',
    'https://codesigning.azure.net.example.com/',
  ]) {
    assert.throws(() => windowsSigningOptions({ ...environment, AZURE_SIGNING_ENDPOINT: endpoint }))
  }
})
