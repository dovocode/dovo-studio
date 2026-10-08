import { createRequire } from 'node:module'
import { test } from 'node:test'
import assert from 'node:assert/strict'
const root = createRequire(import.meta.url)
const builder = createRequire(root.resolve('electron-builder'))
const dependencies = createRequire(builder.resolve('app-builder-lib'))
const forge = dependencies('node-forge')
const braces = dependencies('braces')

await test('RSA verification rejects extra AlgorithmIdentifier elements while accepting normal signatures', () => {
  const keys = forge.pki.rsa.generateKeyPair({ bits: 1024, e: 0x10001 })
  const md = forge.md.sha256.create().update('backport fixture')
  const digest = md.digest().getBytes()
  assert.equal(keys.publicKey.verify(digest, keys.privateKey.sign(md)), true)
  const { asn1 } = forge
  const algorithm = [
    asn1.create(
      asn1.Class.UNIVERSAL,
      asn1.Type.OID,
      false,
      asn1.oidToDer(forge.oids.sha256).getBytes(),
    ),
    asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, ''),
  ]
  const signature = (elements) => {
    const info = asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, [
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.SEQUENCE, true, elements),
      asn1.create(asn1.Class.UNIVERSAL, asn1.Type.OCTETSTRING, false, digest),
    ])
    return keys.privateKey.sign(asn1.toDer(info).getBytes(), 'NONE')
  }
  assert.equal(keys.publicKey.verify(digest, signature(algorithm.slice(0, 1))), true)
  assert.throws(
    () =>
      keys.publicKey.verify(
        digest,
        signature([...algorithm, asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, '')]),
      ),
    /DigestInfo/,
  )
  assert.throws(
    () =>
      keys.publicKey.verify(
        digest,
        signature([
          algorithm[0],
          asn1.create(asn1.Class.UNIVERSAL, asn1.Type.NULL, false, 'unexpected'),
        ]),
      ),
    /DigestInfo/,
  )
})
await test('glob parser bounds brace and parenthesis nesting before recursive processing', () => {
  assert.deepEqual(braces.expand('a/{b,c}/{d,e}'), ['a/b/d', 'a/b/e', 'a/c/d', 'a/c/e'])
  for (const [open, close] of [
    ['{', '}'],
    ['(', ')'],
  ]) {
    assert.throws(() => braces(open.repeat(4000) + 'x' + close.repeat(4000)), {
      name: 'SyntaxError',
      message: /nesting/,
    })
  }
})

await test('numeric sprintf precision stays within native formatter limits', () => {
  const { sprintf } = dependencies('sprintf-js')
  assert.equal(sprintf('%.2f', 1.234), '1.23')
  assert.equal(sprintf('%.10000f', 1).length, 102)
  assert.equal(sprintf('%.10000e', 1).length, 105)
  assert.equal(sprintf('%.10000g', 1), '1')
  assert.equal(sprintf('%.0g', 1), '1')
})
