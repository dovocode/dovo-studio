const { app } = require('electron')
const fs = require('node:fs')
const { execFileSync } = require('node:child_process')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const data = fs.mkdtempSync('/tmp/dovo-folder-check-')
const folders = path.join(data, 'folders')
const longName = 'A long folder name '.repeat(10).trim()
const spacedName = 'Whitespace folder '
for (const folder of ['Alpha', 'Beta', 'Beta/Nested', 'Paged', longName, spacedName, '.hidden'])
  fs.mkdirSync(path.join(folders, folder), { recursive: true })
for (let index = 0; index < 105; index++)
  fs.mkdirSync(path.join(folders, 'Paged', `Project ${String(index).padStart(3, '0')}`))
process.env.DOVO_PORT = '0'
process.env.DOVO_HOST = '127.0.0.1'
app.setPath('userData', path.join(data, 'electron'))
let exitCode = 1
app.once('will-quit', () => {
  fs.rmSync(data, { recursive: true, force: true })
  app.exit(exitCode)
})

async function verifyFolders(config) {
  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  const wait = async (check, description) => {
    for (let index = 0; index < 150; index++) {
      if (check()) return
      await pause(100)
    }
    throw new Error(
      `Folder picker timeout (${description}): ${document.body.innerText.slice(-1400)}`,
    )
  }
  const button = (label) =>
    [...document.querySelectorAll('button')].find(
      (el) =>
        el.getAttribute('aria-label') === label ||
        el.title === label ||
        el.innerText.trim() === label,
    )
  const picker = () => document.querySelector('[aria-label="Runtime folder picker"]')
  const input = () => document.querySelector('[aria-label="Folder path"]')
  const list = () => document.querySelector('[role="listbox"][aria-label="Directories"]')
  const options = () => [...(list()?.querySelectorAll('[role="option"]') ?? [])]
  const option = (name) => options().find((el) => el.title === name)
  const ready = () =>
    picker()?.getAttribute('aria-busy') === 'false' && !button('Choose this folder')?.disabled
  const assert = (condition, message) => {
    if (!condition) throw new Error(message)
  }
  const fill = (label, value) => {
    const el = document.querySelector(`[aria-label="${label}"]`)
    assert(el instanceof HTMLInputElement, `Input missing: ${label}`)
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return el
  }
  const key = (el, value, extra = {}) =>
    el.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, ...extra }))
  const atRoot = () => ready() && !!option('Alpha') && !!option('Beta') && !!option('Paged')
  const openPath = async (value, check) => {
    fill('Folder path', value)
    await wait(() => ready() && check(), `open ${value}`)
  }
  const requestPath = (args) => {
    const url = new URL(args[0] instanceof Request ? args[0].url : String(args[0]))
    if (url.pathname !== '/api/scm/directories/read' || typeof args[1]?.body !== 'string')
      return undefined
    return JSON.parse(args[1].body).path
  }
  const hold = (target) => {
    const original = window.fetch
    let started = false
    let release = () => {}
    const gate = new Promise((resolve) => {
      release = resolve
    })
    window.fetch = async (...args) => {
      const response = await original(...args)
      if (requestPath(args) === target) {
        started = true
        await gate
      }
      return response
    }
    return {
      started: () => started,
      release,
      restore: () => {
        release()
        window.fetch = original
      },
    }
  }

  await wait(() => document.body.innerText.includes('Workspace synced'), 'runtime')
  button('Tasks').click()
  await wait(() => button('Projects'), 'project menu')
  key(button('Projects'), 'ArrowDown')
  await wait(() => document.querySelector('[role="menuitem"]'), 'project commands')
  ;[...document.querySelectorAll('[role="menuitem"]')]
    .find((el) => el.innerText === 'Add project')
    .click()
  await wait(() => button('Browse runtime folders…'), 'add project')
  button('Browse runtime folders…').click()
  await wait(() => list() && ready(), 'initial folders')
  const initialHome = input().value
  input().focus()
  await openPath(config.folders, atRoot)
  assert(document.activeElement === input(), 'A path response stole typing focus')
  assert(options().length === 5, 'Folder-only list or hidden filter changed')
  assert(
    list().getBoundingClientRect().height >
      picker().querySelector('header').getBoundingClientRect().height,
    'Folder list no longer owns most picker space',
  )
  const crumbs = () => [...document.querySelectorAll('nav[aria-label="Folder location"] button')]
  assert(
    crumbs().at(-1)?.title === config.canonicalFolders,
    'Current breadcrumb is not the canonical runtime path',
  )
  assert(crumbs()[0]?.innerText === '/', 'POSIX root breadcrumb is missing')

  option('Beta').click()
  await wait(() => ready() && !!option('Nested'), 'nested folder')
  const rootCrumb = crumbs().find((el) => el.title === config.canonicalFolders)
  assert(!!rootCrumb, 'Parent breadcrumb disappeared')
  rootCrumb.click()
  await wait(atRoot, 'breadcrumb navigation')

  // The old response arrives before the debounce for the new path fires.
  const debounceGate = hold(config.alpha)
  try {
    fill('Folder path', config.alpha)
    await wait(debounceGate.started, 'delayed first path')
    assert(!input().disabled, 'Typing is disabled while loading')
    input().focus()
    fill('Folder path', config.beta + '/')
    debounceGate.release()
    await pause(80)
    assert(input().value === config.beta + '/', 'Stale response replaced the path during debounce')
    assert(button('Choose this folder').disabled, 'Stale folder was selectable during debounce')
    assert(
      picker().getAttribute('aria-busy') === 'true',
      'Stale response cleared loading during debounce',
    )
    await wait(() => ready() && !!option('Nested'), 'latest debounced path')
    assert(
      input().value === config.beta + '/',
      'Canonical response overwrote the path being edited',
    )
    assert(document.activeElement === input(), 'Debounced listing stole edit focus')
  } finally {
    debounceGate.restore()
  }

  const lateGate = hold(config.alpha)
  try {
    fill('Folder path', config.alpha)
    await wait(lateGate.started, 'late first response')
    fill('Folder path', config.beta)
    await wait(() => ready() && !!option('Nested'), 'newer response')
    lateGate.release()
    await pause(100)
    assert(
      input().value === config.beta && !!option('Nested'),
      'Late old response replaced newer results',
    )
  } finally {
    lateGate.restore()
  }

  const homeGate = hold(config.alpha)
  try {
    fill('Folder path', config.alpha)
    await wait(homeGate.started, 'pending folder before Home')
    assert(!button('Home folder').disabled, 'Home is disabled during a pending request')
    button('Home folder').click()
    await wait(() => ready() && input().value === initialHome, 'Home while pending')
    homeGate.release()
    await pause(80)
    assert(input().value === initialHome, 'Old request replaced Home results')
  } finally {
    homeGate.restore()
  }

  await openPath(config.folders, atRoot)
  list().focus()
  key(list(), 'Home')
  assert(
    options()[0]?.getAttribute('aria-selected') === 'true',
    'Home key did not select first folder',
  )
  key(list(), 'ArrowUp')
  await wait(() => options().at(-1)?.getAttribute('aria-selected') === 'true', 'keyboard wrapping')
  key(list(), 'Home')
  await pause(0)
  const betaIndex = options().findIndex((el) => el.title === 'Beta')
  for (let index = 0; index < betaIndex; index++) {
    key(list(), 'ArrowDown')
    await pause(0)
  }
  await wait(
    () => option('Beta')?.getAttribute('aria-selected') === 'true',
    'keyboard folder selection',
  )
  key(list(), 'Enter')
  await wait(() => ready() && !!option('Nested'), 'keyboard open')
  key(list(), 'Backspace')
  await wait(atRoot, 'keyboard parent')
  key(list(), 'l', { metaKey: true })
  assert(document.activeElement === input(), 'Path focus shortcut failed')
  assert(
    input().selectionStart === 0 && input().selectionEnd === input().value.length,
    'Path shortcut did not select the current path',
  )

  button('Folder options').dispatchEvent(
    new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
  )
  await wait(() => document.querySelector('[role="menuitemcheckbox"]'), 'folder options')
  document.querySelector('[role="menuitemcheckbox"]').click()
  await wait(() => ready() && !!option('.hidden'), 'hidden folders')
  assert(options().length === 6, 'Unexpected hidden folder count')
  option('Paged').click()
  await wait(() => ready() && options().length === 100, 'first folder page')
  assert(picker().innerText.includes('1–100 of 105'), 'Total folder count was not shown')
  button('Next').click()
  await wait(() => ready() && options().length === 5, 'second folder page')
  assert(picker().innerText.includes('101–105 of 105'), 'Second page range incorrect')
  button('Previous').click()
  await wait(() => ready() && options().length === 100, 'previous folder page')
  fill('Filter folders', 'PROJECT 104')
  await wait(
    () => ready() && options().length === 1 && !!option('Project 104'),
    'filter across pages',
  )
  fill('Filter folders', 'not found')
  await wait(() => ready() && picker().innerText.includes('No matching folders.'), 'empty filter')
  assert(!button('Choose this folder').disabled, 'Empty filtered folder cannot be chosen')
  fill('Filter folders', '')
  await wait(() => ready() && options().length === 100, 'clear filter')
  button('Parent folder').click()
  await wait(atRoot, 'parent button')

  assert(option(config.longName)?.textContent === config.longName, 'Long folder name was lost')
  option(config.longName).click()
  await wait(() => ready() && !options().length, 'long folder path')
  assert(input().value === config.longPath, 'Long folder path changed')
  button('Parent folder').click()
  await wait(atRoot, 'parent from long folder')
  option(config.spacedName).click()
  await wait(() => ready() && !options().length, 'folder ending in whitespace')
  assert(input().value === config.spacedPath, 'Folder whitespace was trimmed')
  button('Parent folder').click()
  await wait(atRoot, 'parent from whitespace folder')

  fill('Folder path', config.missing)
  await wait(() => !!picker().querySelector('[role="alert"]'), 'invalid folder')
  assert(
    button('Choose this folder').disabled,
    'Last successful folder can be chosen after an error',
  )
  key(input(), 'Enter', { metaKey: true })
  assert(!!picker(), 'Keyboard confirmed a stale folder after an error')
  assert(!button('Home folder').disabled, 'Home is disabled after a folder error')
  button('Home folder').click()
  await wait(() => ready() && input().value === initialHome, 'Home after error')
  await openPath(config.folders, atRoot)

  const originalFetch = window.fetch
  try {
    window.fetch = async (...args) => {
      const url = new URL(args[0] instanceof Request ? args[0].url : String(args[0]))
      if (url.pathname === '/api/snapshot') throw new TypeError('Fixture network interruption')
      return originalFetch(...args)
    }
    await wait(() => picker().innerText.includes('This computer is offline.'), 'offline state')
    assert(
      button('Choose this folder').disabled && input().disabled && button('Home folder').disabled,
      'Offline picker still permits selection or navigation',
    )
  } finally {
    window.fetch = originalFetch
  }
  await wait(atRoot, 'automatic reconnect')

  return {
    livePathUpdates: true,
    breadcrumbs: true,
    typingFocus: true,
    debounceRace: true,
    staleResponsesIgnored: true,
    homeDuringPending: true,
    keyboardNavigation: true,
    hiddenFolders: true,
    pagination: true,
    filterAcrossPages: true,
    longPaths: true,
    exactWhitespace: true,
    staleSelectionBlocked: true,
    homeErrorRecovery: true,
    offlineReconnect: true,
  }
}

async function verifyCompactLayout() {
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  const dialog = document.querySelector('[role="dialog"]')
  const picker = document.querySelector('[aria-label="Runtime folder picker"]')
  const choose = [...picker.querySelectorAll('button')].find(
    (el) => el.innerText === 'Choose this folder',
  )
  const describe = (element) => {
    const style = getComputedStyle(element)
    return {
      className: element.className,
      box: element.getBoundingClientRect().toJSON(),
      maxHeight: style.maxHeight,
      minHeight: style.minHeight,
      height: style.height,
      display: style.display,
      flexShrink: style.flexShrink,
      overflowY: style.overflowY,
    }
  }
  const assertFits = (phase) => {
    const box = dialog.getBoundingClientRect()
    if (box.left < -1 || box.right > innerWidth + 1 || box.top < -1 || box.bottom > innerHeight + 1)
      throw new Error(
        `Folder dialog exceeds compact viewport (${phase}): ${JSON.stringify({ width: innerWidth, height: innerHeight, visualViewport: { width: visualViewport.width, height: visualViewport.height }, dialog: describe(dialog), picker: describe(picker), list: describe(picker.querySelector('[role="listbox"]')) })}`,
      )
  }
  assertFits('immediately after resize')
  // Also inspect the settled layout after any entry animations have finished.
  await Promise.all(dialog.getAnimations().map((animation) => animation.finished))
  await new Promise((resolve) => requestAnimationFrame(resolve))
  assertFits('settled')
  if (
    dialog.scrollWidth > dialog.clientWidth + 1 ||
    document.documentElement.scrollWidth > innerWidth + 1
  )
    throw new Error('Compact folder picker has horizontal overflow')
  choose.scrollIntoView({ block: 'nearest' })
  await new Promise((resolve) => requestAnimationFrame(resolve))
  const footer = choose.getBoundingClientRect()
  if (footer.top < 0 || footer.bottom > innerHeight)
    throw new Error('Choose folder is unreachable in a short viewport')
  return { compactLayout: true, width: innerWidth, height: innerHeight }
}

app.on('browser-window-created', (_event, window) => {
  window.webContents.once('did-finish-load', async () => {
    try {
      window.webContents.setBackgroundThrottling(false)
      window.show()
      const config = {
        folders,
        canonicalFolders: fs.realpathSync(folders),
        alpha: path.join(folders, 'Alpha'),
        beta: path.join(folders, 'Beta'),
        missing: path.join(folders, 'not-there'),
        longName,
        longPath: fs.realpathSync(path.join(folders, longName)),
        spacedName,
        spacedPath: fs.realpathSync(path.join(folders, spacedName)),
      }
      const result = await window.webContents.executeJavaScript(
        `(${verifyFolders.toString()})(${JSON.stringify(config)})`,
      )
      fs.writeFileSync(
        '/tmp/dovo-folder-picker.png',
        (await window.webContents.capturePage()).toPNG(),
      )
      window.setMinimumSize(480, 420)
      window.setSize(620, 480)
      const compact = await window.webContents.executeJavaScript(
        `(${verifyCompactLayout.toString()})()`,
      )
      fs.writeFileSync(
        '/tmp/dovo-folder-picker-compact.png',
        (await window.webContents.capturePage()).toPNG(),
      )
      window.setSize(1180, 760)
      execFileSync('git', ['init', '-q', folders])
      await window.webContents.executeJavaScript(`(async () => {
        const list = document.querySelector('[role="listbox"][aria-label="Directories"]');
        list.dispatchEvent(new KeyboardEvent('keydown', {key:'Enter',metaKey:true,bubbles:true}));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        if (document.querySelector('[aria-label="Runtime folder picker"]')) throw new Error('Choose folder did not return to form');
        if (![...document.querySelectorAll('input')].some(el => el.value === ${JSON.stringify(fs.realpathSync(folders))})) throw new Error('Selected folder did not populate the form');
        const wait = async check => { for (let i=0; i<150; i++) { if (check()) return; await new Promise(resolve=>setTimeout(resolve,100)) } throw new Error('Project menu timeout: '+document.body.innerText.slice(-1400)) };
        const button = label => [...document.querySelectorAll('button')].find(el => el.getAttribute('aria-label')===label || el.innerText.trim()===label);
        button('Add project').click(); await wait(()=>!document.querySelector('[role="dialog"]'));
        button('Projects').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
        await wait(()=>[...document.querySelectorAll('[role="menuitemradio"]')].some(el=>el.innerText==='folders'));
        [...document.querySelectorAll('[role="menuitemradio"]')].find(el=>el.innerText==='folders').click();
        await wait(()=>button('Projects').innerText.includes('folders'));
        button('Projects').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}));
        await wait(()=>[...document.querySelectorAll('[role="menuitem"]')].some(el=>el.innerText==='Project settings'));
        [...document.querySelectorAll('[role="menuitem"]')].find(el=>el.innerText==='Project settings').click();
        await wait(()=>button('Working directory'));
      })()`)
      console.log(
        JSON.stringify({
          ...result,
          ...compact,
          chooseCurrentFolder: true,
          addProject: true,
          projectMenu: true,
          projectSettings: true,
        }),
      )
      exitCode = 0
      app.quit()
    } catch (error) {
      fs.writeFileSync(
        '/tmp/dovo-folder-picker-failure.png',
        (await window.webContents.capturePage()).toPNG(),
      )
      console.error(error)
      app.quit()
    }
  })
})
setTimeout(() => {
  console.error('Folder verification timeout')
  app.quit()
}, 120000).unref()
import(root + '/apps/desktop/dist-electron/main.js').catch((error) => {
  console.error(error)
  app.exit(1)
})
