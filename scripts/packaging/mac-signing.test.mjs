import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const builderRequire = createRequire(require.resolve('electron-builder'))
const appRequire = createRequire(builderRequire.resolve('app-builder-lib'))
const util = appRequire('builder-util')
const certificates = builderRequire('app-builder-lib/out/codeSign/codesign.js')
const { createKeychain } = builderRequire('app-builder-lib/out/codeSign/macCodeSign.js')

await test('uses the export password for certificate import and the generated keychain password for permissions', async () => {
  const commands = []
  const originalTravis = process.env.TRAVIS
  // Skip the unrelated root-certificate cache; all security commands remain mocked.
  process.env.TRAVIS = 'true'
  mock.method(util, 'exec', async (file, args) => {
    assert.equal(file, '/usr/bin/security')
    commands.push(args)
    return ''
  })
  mock.method(certificates, 'importCertificate', async () => '/test/signing.p12')
  try {
    await createKeychain({
      tmpDir: {},
      cscLink: 'test-certificate',
      cscKeyPassword: 'export-password',
      currentDir: '/test/dovo-build',
    })
    const create = commands.find((args) => args[0] === 'create-keychain')
    const unlock = commands.find((args) => args[0] === 'unlock-keychain')
    const imported = commands.find((args) => args[0] === 'import')
    const permissions = commands.find((args) => args[0] === 'set-key-partition-list')
    assert.ok(create && unlock && imported && permissions)
    const keychainPassword = create[create.indexOf('-p') + 1]
    assert.notEqual(keychainPassword, 'export-password')
    assert.equal(unlock[unlock.indexOf('-p') + 1], keychainPassword)
    assert.equal(imported[imported.indexOf('-P') + 1], 'export-password')
    assert.equal(permissions[permissions.indexOf('-k') + 1], keychainPassword)
  } finally {
    mock.restoreAll()
    if (originalTravis === undefined) delete process.env.TRAVIS
    else process.env.TRAVIS = originalTravis
  }
})
