import { afterEach, expect, it } from 'vite-plus/test'
import { generateKeyPairSync, sign, randomBytes } from 'node:crypto'
import {
  internetPublicKey,
  internetRegistrationPayload,
  sealInternet,
  openInternet,
} from '@dovo/protocol'
import { AccountStore, hash } from './store.js'
import { InternetStore } from './internet-store.js'
const resources: AccountStore[] = []
afterEach(() => {
  for (const store of resources.splice(0)) store.db.close()
})
function fixture() {
  let now = Date.now()
  const accounts = new AccountStore(':memory:', () => now)
  resources.push(accounts)
  const store = new InternetStore(accounts, 'https://connect.test')
  const session = (user = 'same-account') => {
    const { token, login } = accounts.createLogin()
    accounts.approve(login, { id: user, name: user })
    return token
  }
  const owner = session(),
    phone = session(),
    stranger = session('other')
  const signing = generateKeyPairSync('ed25519'),
    boxSecret = randomBytes(32)
  const registration = {
    id: 'runtime',
    name: 'Desktop',
    identity: signing.publicKey.export({ type: 'spki', format: 'der' }).toString('base64url'),
    publicKey: internetPublicKey(boxSecret),
    timestamp: now,
  }
  const proof = {
    ...registration,
    signature: sign(
      null,
      Buffer.from(internetRegistrationPayload('https://connect.test', hash(owner), registration)),
      signing.privateKey,
    ).toString('base64url'),
  }
  const grant = store.register(owner, proof).grant
  store.inbox(grant)
  return {
    accounts,
    store,
    owner,
    phone,
    stranger,
    grant,
    proof,
    boxSecret,
    advance: (ms: number) => {
      now += ms
    },
  }
}
it('only the same signed-in account can request a connection; directory links grant no access', () => {
  const f = fixture(),
    clientKey = internetPublicKey(randomBytes(32))
  expect(f.store.directory('same-account')[0].internet.online).toBe(true)
  expect(() => f.store.request(f.stranger, 'runtime', clientKey)).toThrow('offline')
  f.accounts.link('other', { id: 'runtime', name: 'Forged link', address: 'http://lan:5000' })
  expect(() => f.store.request(f.stranger, 'runtime', clientKey)).toThrow('offline')
  const request = f.store.request(f.phone, 'runtime', clientKey)
  expect(f.store.inbox(f.grant).requests).toEqual([
    { id: request.id, publicKey: clientKey, session: hash(f.phone) },
  ])
  expect(() => f.store.result(f.stranger, request.id)).toThrow('expired')
})
it('rejects substituted keys, another account session, another audience and expired registration proofs', () => {
  const f = fixture()
  expect(() => f.store.register(f.stranger, f.proof)).toThrow('proof')
  expect(() => f.store.register(f.owner, { ...f.proof, publicKey: 'f'.repeat(64) })).toThrow(
    'proof',
  )
  const other = new InternetStore(f.accounts, 'https://another.test')
  expect(() => other.register(f.owner, f.proof)).toThrow('proof')
  f.advance(60001)
  expect(() => f.store.register(f.owner, f.proof)).toThrow('expired')
})
it('stores only encrypted credentials, authenticates ciphertext, and binds responses to the requesting session', () => {
  const f = fixture(),
    client = randomBytes(32),
    wrong = randomBytes(32)
  const request = f.store.request(f.phone, 'runtime', internetPublicKey(client))
  const box = sealInternet(
    {
      requestId: request.id,
      token: 'never-seen-by-connect',
      secret: 'never-seen-by-connect-either',
    },
    internetPublicKey(client),
    f.boxSecret,
    randomBytes(24),
  )
  f.store.answer(f.grant, request.id, box)
  const result = f.store.result(f.phone, request.id)
  expect(openInternet(box, result.publicKey, client)).toEqual({
    requestId: request.id,
    token: 'never-seen-by-connect',
    secret: 'never-seen-by-connect-either',
  })
  expect(() => openInternet(box, result.publicKey, wrong)).toThrow('authenticated')
  const changed = {
    ...box,
    ciphertext: (box.ciphertext[0] === 'a' ? 'b' : 'a') + box.ciphertext.slice(1),
  }
  expect(() => openInternet(changed, result.publicKey, client)).toThrow('authenticated')
  expect(
    JSON.stringify(f.accounts.db.prepare('SELECT * FROM internet_requests').all()),
  ).not.toContain('never-seen')
  expect(() => f.store.answer('bad', request.id, box)).toThrow('revoked')
})
it('revokes active grants on owner signout, account deletion and disabling/unlinking the computer', () => {
  for (const revoke of ['signout', 'delete', 'disable'] as const) {
    const f = fixture()
    const request = f.store.request(f.phone, 'runtime', internetPublicKey(randomBytes(32)))
    if (revoke === 'signout') f.accounts.revoke(f.owner)
    if (revoke === 'delete') f.accounts.beginDeletion('same-account')
    if (revoke === 'disable') f.store.remove('same-account', 'runtime')
    expect(f.store.host(f.grant)).toBeUndefined()
    expect(() => f.store.inbox(f.grant)).toThrow('revoked')
    expect(() => f.store.result(f.phone, request.id)).toThrow(/expired|Sign in again/)
  }
})
it('phone signout removes its request; owner device revocation blocks regranting that account session', () => {
  const f = fixture()
  const request = f.store.request(f.phone, 'runtime', internetPublicKey(randomBytes(32)))
  f.store.block(f.grant, hash(f.phone))
  expect(f.store.inbox(f.grant).active).not.toContain(request.id)
  expect(() => f.store.request(f.phone, 'runtime', internetPublicKey(randomBytes(32)))).toThrow(
    'revoked',
  )
  const { login, token } = f.accounts.createLogin()
  f.accounts.approve(login, { id: 'same-account', name: 'phone' })
  const fresh = f.store.request(token, 'runtime', internetPublicKey(randomBytes(32)))
  f.accounts.revoke(token)
  expect(f.store.inbox(f.grant).active).not.toContain(fresh.id)
})
it('deletes account encryption metadata and stops advertising offline computers as online', () => {
  const f = fixture()
  f.store.request(f.phone, 'runtime', internetPublicKey(randomBytes(32)))
  f.advance(15001)
  expect(f.store.directory('same-account')[0].internet.online).toBe(false)
  expect(() => f.store.request(f.phone, 'runtime', internetPublicKey(randomBytes(32)))).toThrow(
    'offline',
  )
  f.accounts.deleteAccount('same-account')
  expect(f.accounts.db.prepare('SELECT * FROM internet_hosts').all()).toEqual([])
  expect(f.accounts.db.prepare('SELECT * FROM internet_requests').all()).toEqual([])
})
