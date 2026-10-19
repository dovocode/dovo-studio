import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { windowsSigningOptions, windowsArtifactSigningOptions } from './windows-signing.mjs'

const require = createRequire(import.meta.url)
const builderRequire = createRequire(require.resolve('electron-builder'))
const { WindowsSignToolManager } = builderRequire(
  'app-builder-lib/out/codeSign/windowsSignToolManager.js',
)

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

function signingManager(options) {
  return new WindowsSignToolManager({
    platformSpecificBuildOptions: { signtoolOptions: options },
    appInfo: {
      type: 'module',
      productName: 'Dovo Studio',
      computePackageUrl: async () => 'https://dovo.studio',
    },
    info: { getWorkspaceRoot: async () => process.cwd() },
    getCscLink: () => null,
  })
}

await test('electron-builder signs helpers, uninstallers and installers once with Artifact Signing and SHA256', async () => {
  const calls = []
  const options = windowsArtifactSigningOptions(windowsSigningOptions(environment), (...args) => {
    calls.push(args)
  })
  const manager = signingManager(options)
  assert.deepEqual(await manager.computedPublisherName.value, ['Verified Publisher'])
  for (const path of [
    'C:\\Dovo Studio\\resources\\elevate.exe',
    "C:\\O'Brien\\$(not-code); uninstaller.exe",
    'C:\\release\\Dovo-Studio-Nightly-windows-arm64.exe',
  ]) {
    const before = calls.length
    assert.equal(await manager.signFile({ path, options: { signtoolOptions: options } }), true)
    assert.equal(calls.length, before + 1, 'Do not dual-sign or repeat a signing request')
    const [command, args, execution] = calls.at(-1)
    assert.equal(command, 'pwsh.exe')
    assert.deepEqual(args.slice(0, 4), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command'])
    assert.match(args[4], /Import-Module ArtifactSigning -MinimumVersion 0\.1\.8/)
    assert.match(args[4], /Invoke-ArtifactSigning @parameters/)
    assert.doesNotMatch(args[4], /Invoke-TrustedSigning|Install-Module/)
    assert.ok(!args.includes(path) && !args[4].includes(path), 'Paths remain data')
    assert.deepEqual(JSON.parse(execution.env.DOVO_ARTIFACT_SIGNING_REQUEST), {
      Endpoint: environment.AZURE_SIGNING_ENDPOINT,
      CodeSigningAccountName: environment.AZURE_SIGNING_ACCOUNT,
      CertificateProfileName: environment.AZURE_SIGNING_PROFILE,
      Files: path,
      FileDigest: 'SHA256',
      TimestampRfc3161: 'http://timestamp.acs.microsoft.com',
      TimestampDigest: 'SHA256',
    })
    assert.equal(execution.timeout, 360000)
    assert.equal(execution.stdio, 'inherit')
  }
})

await test('a provider signing failure rejects packaging instead of producing an unsigned release', async () => {
  let calls = 0
  const failure = new Error('Artifact Signing rejected the request')
  const options = windowsArtifactSigningOptions(windowsSigningOptions(environment), () => {
    calls++
    throw failure
  })
  await assert.rejects(
    signingManager(options).signFile({
      path: 'C:\\release\\installer.exe',
      options: { signtoolOptions: options },
    }),
    (error) => error === failure,
  )
  assert.equal(calls, 1)
})
