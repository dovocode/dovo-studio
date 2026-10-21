import { Schema } from 'effect'
import {
  decode,
  artifactSessionSchema,
  artifactViewSchema,
  artifactAccessSchema,
  artifactPublicationsSchema,
  accountLoginSchema,
  mutableStruct,
  artifactFeedDataSchema,
} from '@dovo/protocol'

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) {
  const result = document.createElement(tag)
  if (text !== undefined) result.textContent = text
  return result
}
function required(id: string) {
  const found = document.getElementById(id)
  if (!found) throw new Error('Page unavailable')
  return found
}
const content = required('content'),
  auth = required('auth'),
  identity = required('identity'),
  status = required('status')
const parts = location.pathname.split('/'),
  id = parts.length === 3 ? parts[2] : undefined
const fragment = new URLSearchParams(location.hash.slice(1)),
  linkToken = fragment.get('share')
const appSession = fragment.get('session')
if (appSession) history.replaceState(null, '', location.pathname)
let session: typeof artifactSessionSchema.Type | undefined
let busy = false
let createdLink: string | undefined
let stopFeed: (() => void) | undefined
class RequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}
async function request(path: string, method = 'GET', data?: unknown, share = false) {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
    headers: {
      ...(data === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(share && linkToken && /^[A-Za-z0-9_-]{43}$/.test(linkToken)
        ? { Authorization: 'DovoShare ' + linkToken }
        : {}),
    },
    body: data === undefined ? undefined : JSON.stringify(data),
  })
  if (!response.ok) {
    throw new RequestError(
      response.status,
      response.status === 401
        ? 'Sign in to continue'
        : response.status === 404
          ? 'Artifact unavailable or access not granted'
          : 'Request failed. Try again later',
    )
  }
  return (await response.json()) as unknown
}
function message(text: string, error = false) {
  status.textContent = text
  status.className = error ? 'error' : ''
}
async function run(action: () => Promise<void>) {
  if (busy) return
  busy = true
  message('Working…')
  const buttons = [...document.querySelectorAll('button')].map((button) => ({
    button,
    disabled: button.disabled,
  }))
  buttons.forEach(({ button }) => {
    button.disabled = true
  })
  try {
    await action()
  } catch (error) {
    message(error instanceof Error ? error.message : 'Request failed', true)
  } finally {
    busy = false
    buttons.forEach(({ button, disabled }) => {
      button.disabled = disabled
    })
  }
}
function button(label: string, action: () => Promise<void>) {
  const node = element('button', label)
  node.type = 'button'
  node.onclick = () => {
    void run(action)
  }
  return node
}
function section(title: string, parent = content) {
  const block = element('section')
  block.append(element('h2', title))
  parent.append(block)
  return block
}
function link(url: string, label: string) {
  const row = element('div')
  row.className = 'row'
  const input = element('input')
  input.readOnly = true
  input.value = url
  input.setAttribute('aria-label', label)
  input.style.flex = '1'
  row.append(
    input,
    button('Copy ' + label.toLowerCase(), async () => {
      try {
        await navigator.clipboard.writeText(url)
        message('Copied')
      } catch {
        input.select()
        message('Select and copy the value above')
      }
    }),
  )
  return row
}
function account() {
  identity.replaceChildren()
  auth.replaceChildren()
  if (session) {
    identity.append(
      element('span', session.user.name),
      button('Sign out', async () => {
        await request('/auth/logout', 'POST', {})
        session = undefined
        await load()
      }),
    )
    const block = section('Your sharing identity', auth)
    block.append(
      element('p', 'Send this sharing ID to an artifact owner so they can invite your account.'),
      link(session.user.id, 'Sharing ID'),
    )
  } else {
    const block = section('Private artifact access', auth)
    block.append(
      element(
        'p',
        'Sign in with Dovo or your organization SSO to view invited artifacts and manage your publications.',
      ),
      button('Sign in', async () => {
        const value = decode(
          mutableStruct({
            code: accountLoginSchema.fields.code,
            url: accountLoginSchema.fields.url,
            expiresAt: accountLoginSchema.fields.expiresAt,
          }),
          await request('/auth/start', 'POST', {}),
        )
        block.replaceChildren(
          element('h2', 'Compare your sign-in code'),
          element('code', value.code),
        )
        const start = element('a', 'Continue to sign-in')
        start.href = value.url
        start.target = '_blank'
        start.rel = 'noopener noreferrer'
        block.append(
          element(
            'p',
            'Check that the sign-in page shows this code. Return here after signing in.',
          ),
          start,
          button('Check sign-in', async () => {
            let state: { ready: boolean }
            try {
              state = decode(
                mutableStruct({ ready: Schema.Boolean }),
                await request('/auth/status'),
              )
            } catch (error) {
              if (!(error instanceof RequestError) || error.status !== 401) throw error
              account()
              message('Sign-in expired. Start again', true)
              return
            }
            if (!state.ready) {
              message('Sign-in is still pending')
              return
            }
            await load()
          }),
          button('Cancel sign-in', async () => {
            await request('/auth/logout', 'POST', {})
            await load()
          }),
        )
        message('Sign-in expires in five minutes')
      }),
    )
  }
}
async function manage() {
  if (!id) return
  const path = '/v1/publications/' + id
  const access = decode(artifactAccessSchema, await request(path + '/access'))
  if (access.feed) {
    const feed = section('Live data feed')
    feed.append(
      element(
        'p',
        `Publisher-approved query, configured every ${access.feed.seconds / 60} minute(s). Permission expires ${new Date(access.feed.expiresAt).toLocaleString()}. Cached data follows the same invitation and share-link access as this artifact.`,
      ),
      button('Stop and clear live feed', async () => {
        await request(path + '/feed', 'DELETE', { generation: access.feed?.generation })
        await load()
        message('Live feed stopped and cached data cleared')
      }),
    )
  }
  const block = section('Sharing settings')
  block.append(
    element(
      'p',
      'Private by default. Only you and the accounts listed below can use the private link.',
    ),
    link(location.origin + '/s/' + id, 'Private artifact link'),
  )
  const invite = element('div')
  invite.className = 'row'
  const input = element('input')
  input.placeholder = 'Recipient sharing ID'
  input.setAttribute('aria-label', 'Recipient sharing ID')
  input.maxLength = 500
  invite.append(
    input,
    button('Invite account', async () => {
      if (!input.value.trim()) {
        message('Enter the recipient’s sharing ID', true)
        return
      }
      await request(path + '/invites', 'POST', { userId: input.value.trim() })
      await load()
      message('Account invited')
    }),
  )
  block.append(
    element(
      'p',
      'Ask the recipient to sign in here and copy their sharing ID. Names and email addresses are not sharing IDs.',
    ),
    invite,
  )
  for (const member of access.invites) {
    const row = element('div')
    row.className = 'row'
    row.append(
      element('code', member.userId),
      button('Remove access', async () => {
        await request(path + '/invites', 'DELETE', member)
        await load()
        message('Invitation revoked')
      }),
    )
    block.append(row)
  }
  const publicBlock = section('Optional shareable links')
  publicBlock.append(
    element(
      'p',
      'Anyone holding a shareable link can view this saved artifact without signing in. They may save a copy. Revocation blocks future access; it cannot recall saved copies.',
    ),
  )
  const expiry = element('select')
  expiry.setAttribute('aria-label', 'Share link lifetime')
  for (const [value, name] of [
    [3600, '1 hour'],
    [86400, '1 day'],
    [604800, '7 days'],
    [2592000, '30 days'],
  ] as const) {
    const option = element('option', name)
    option.value = String(value)
    expiry.append(option)
  }
  const row = element('div')
  row.className = 'row'
  row.append(
    expiry,
    button('Create anyone-with-link access', async () => {
      const value = decode(
        mutableStruct({ url: Schema.String }),
        await request(path + '/links', 'POST', { seconds: Number(expiry.value) }),
      )
      createdLink = value.url
      await load()
      message('Shareable link created. Copy it now; it is shown only in this session')
    }),
  )
  publicBlock.append(row)
  if (createdLink) publicBlock.append(link(createdLink, 'Shareable artifact link'))
  for (const share of access.links) {
    const row = element('div')
    row.className = 'row'
    row.append(
      element('span', `Expires ${new Date(share.expiresAt).toLocaleString()}`),
      button('Revoke link', async () => {
        await request(path + '/links/' + share.id, 'DELETE')
        createdLink = undefined
        await load()
        message('Share link revoked')
      }),
    )
    publicBlock.append(row)
  }
  const deletion = section('Remove hosted copy')
  deletion.append(
    button('Delete hosted artifact', async () => {
      if (
        !confirm(
          'Delete this hosted copy and revoke all its invitations and links? Your local artifact is kept.',
        )
      ) {
        message('Deletion cancelled')
        return
      }
      await request(path, 'DELETE')
      location.assign('/')
    }),
  )
}
async function load() {
  stopFeed?.()
  stopFeed = undefined
  message('Loading…')
  content.replaceChildren()
  try {
    session = decode(artifactSessionSchema, await request('/v1/me'))
  } catch (error) {
    if (!(error instanceof RequestError) || error.status !== 401) throw error
    session = undefined
  }
  account()
  if (!id) {
    if (!session) {
      message('')
      return
    }
    const value = decode(artifactPublicationsSchema, await request('/v1/publications'))
    const block = section('Your published artifacts')
    if (!value.publications.length)
      block.append(element('p', 'Publish a saved version using Share artifact in Dovo Studio.'))
    for (const item of value.publications) {
      const row = element('p'),
        a = element('a', `${item.title} · Version ${item.revision}`)
      a.href = '/manage/' + item.id
      row.append(a)
      block.append(row)
    }
    message('')
    return
  }
  const value = decode(
    artifactViewSchema,
    await request('/v1/publications/' + id, 'GET', undefined, true),
  )
  document.title = value.publication.title + ' · Dovo Artifacts'
  const preview = section(value.publication.title)
  preview.append(
    element(
      'p',
      `Saved version ${value.publication.revision} · Published ${new Date(value.publication.createdAt).toLocaleString()}`,
    ),
  )
  const frame = element('iframe')
  frame.title = 'Artifact preview'
  frame.setAttribute('sandbox', 'allow-scripts allow-downloads')
  frame.referrerPolicy = 'no-referrer'
  frame.setAttribute(
    'allow',
    "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-write 'none'",
  )
  frame.srcdoc = value.content
  preview.append(frame)
  const feedStatus = element('p')
  feedStatus.setAttribute('aria-label', 'Live data status')
  feedStatus.className = 'muted'
  preview.append(feedStatus)
  let lastFeed: typeof artifactFeedDataSchema.Type | undefined,
    stopped = false,
    timer: ReturnType<typeof setTimeout> | undefined
  const push = (unavailable = false) => {
    if (!lastFeed || stopped) return
    const stale =
      unavailable ||
      !lastFeed.enabled ||
      lastFeed.updatedAt === null ||
      Date.now() - lastFeed.updatedAt > lastFeed.seconds * 2000
    const text =
      lastFeed.updatedAt === null
        ? 'No live feed configured'
        : `Last data received ${new Date(lastFeed.updatedAt).toLocaleString()}${stale ? ' · Stale' : ''}${unavailable ? ' · Refresh unavailable' : ''}`
    feedStatus.textContent = text
    frame.contentWindow?.postMessage(
      {
        type: 'dovo:artifact-data',
        payload: {
          data: lastFeed.data,
          updatedAt: lastFeed.updatedAt,
          stale,
          enabled: lastFeed.enabled,
        },
      },
      '*',
    )
  }
  frame.addEventListener('load', () => push())
  stopFeed = () => {
    stopped = true
    clearTimeout(timer)
  }
  const refreshFeed = async () => {
    try {
      if (document.visibilityState === 'hidden') return
      const next = decode(
        artifactFeedDataSchema,
        await request('/v1/publications/' + id + '/feed', 'GET', undefined, true),
      )
      if (stopped) return
      lastFeed = next
      push()
    } catch (error) {
      if (stopped) return
      if (error instanceof RequestError && [401, 404].includes(error.status)) {
        stopFeed?.()
        content.replaceChildren()
        session = undefined
        account()
        message('Artifact unavailable or access not granted', true)
      } else {
        feedStatus.textContent = 'Live data refresh unavailable'
        push(true)
      }
    } finally {
      if (!stopped)
        timer = setTimeout(() => {
          void refreshFeed()
        }, 15000)
    }
  }
  void refreshFeed()
  if (value.owner) {
    if (parts[1] === 'manage') await manage()
    else {
      const a = element('a', 'Manage sharing')
      a.href = '/manage/' + id
      preview.append(a)
    }
  }
  message('')
}
void run(async () => {
  if (appSession) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(appSession)) throw new Error('Invalid sharing session')
    try {
      await request('/auth/session', 'POST', { token: appSession })
    } catch (error) {
      // An expired app handoff must still offer the ordinary sharing-only browser sign-in.
      if (!(error instanceof RequestError) || error.status !== 401) throw error
    }
  }
  await load()
})
