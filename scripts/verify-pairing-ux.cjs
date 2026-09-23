// Run after pnpm build. Uses a temporary desktop profile and an ephemeral runtime.
const { app } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const stalled = require('node:http').createServer((_request, response) => {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (_request.method === 'OPTIONS') {
    response.writeHead(204)
    response.end()
  }
  // Intentionally leave pairing confirmation pending to exercise startup recovery.
})
stalled.listen(0, '127.0.0.1')
const directory = fs.mkdtempSync('/tmp/dovo-pairing-ux-')
process.env.DOVO_PORT = '0'
delete process.env.DOVO_HOST
app.setPath('userData', directory)
let exitCode = 0
app.once('will-quit', () => {
  stalled.closeAllConnections()
  stalled.close()
  fs.rmSync(directory, { recursive: true, force: true })
  app.exit(exitCode)
})
app.on('browser-window-created', (_event, window) => {
  window.webContents.once('did-finish-load', async () => {
    try {
      await window.webContents.executeJavaScript(`(async () => {
        const wait = async (check) => { for (let i = 0; i < 150; i++) { if (check()) return; await new Promise(resolve => setTimeout(resolve, 100)) } throw new Error('UI timeout: ' + document.body.innerText.slice(-1500)) }
        const button = label => [...document.querySelectorAll('button')].find(item => item.getAttribute('aria-label') === label || item.textContent.trim() === label)
        await wait(() => document.body.innerText.includes('Workspace synced'))
        button('Settings').click()
        await wait(() => button('Devices & runtime')); button('Devices & runtime').click()
        await wait(() => button('Manage')); button('Manage').click()
        await wait(() => button('Enable LAN / VPN access'))
        if (!document.body.innerText.includes('Connections limited to this Mac')) throw new Error('Missing listener state')
        button('Enable LAN / VPN access').click()
        await wait(() => button('Limit access to this Mac') && document.querySelector('img[alt^="Pairing QR code"]'))
        await wait(() => document.querySelector('img[alt^="Pairing QR code"]'))
        const image = document.querySelector('img[alt^="Pairing QR code"]')
        await wait(() => image.complete && image.naturalWidth > 0)
        if (image.getBoundingClientRect().width < 200) throw new Error('Pairing QR is too small')
        if (!document.body.innerText.includes('remaining')) throw new Error('Missing expiry countdown')
        if (!button('Copy address')) throw new Error('Missing copy address action')
        const connection = await window.dovo.runtimeConnection()
        const call = async (endpoint, input, token = connection.token) => {
          const response = await fetch(connection.address + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(input) })
          const value = await response.json(); if (!response.ok) throw new Error(value.error); return value
        }
        const restartToggle = () => [...document.querySelectorAll('input[type="checkbox"]')].find(input => input.closest('label')?.textContent.includes('Auto-continue tasks after runtime restart'))
        await wait(() => restartToggle() && !restartToggle().disabled)
        if (restartToggle().checked) throw new Error('Auto-continue must default off')
        restartToggle().click()
        await wait(() => restartToggle().checked && !restartToggle().disabled)
        if (!(await call('/api/runtime/preferences/read', {})).autoContinueAfterRestart) throw new Error('Auto-continue was not persisted')
        restartToggle().click()
        await wait(() => !restartToggle().checked && !restartToggle().disabled)
        if ((await call('/api/runtime/preferences/read', {})).autoContinueAfterRestart) throw new Error('Auto-continue could not be disabled')
        const displayedCode = [...document.querySelectorAll('p')].map(item => item.textContent.trim()).find(value => /^\\d{8}$/.test(value))
        if (!displayedCode) throw new Error('Missing manual pairing code')
        await new Promise(resolve => setTimeout(resolve, 100))
        const request = await call('/api/pair/request', { protocolVersion: 2, code: displayedCode, name: 'UX test phone' }, '')
        await wait(() => button('Approve'))
        if (!document.body.innerText.includes('Request received')) throw new Error('Missing approval progress')
        if (!document.body.innerText.includes('full access')) throw new Error('Missing access explanation')
        button('Approve').click()
        let claim
        for (let i = 0; i < 40; i++) { claim = await call('/api/pair/claim', request, ''); if (claim.status === 'approved') break; await new Promise(resolve => setTimeout(resolve, 100)) }
        if (!claim?.token) throw new Error('Host approval did not complete')
        await call('/api/pair/confirm', request, '')
        window.__pairingUxPassed = true
      })()`)
      // Generate a fresh invitation so the screenshot exercises the complete compact layout.
      await window.webContents.executeJavaScript(
        `document.querySelector('button') && [...document.querySelectorAll('button')].find(item => item.textContent.trim() === 'Connect your phone')?.click()`,
      )
      await new Promise((resolve) => setTimeout(resolve, 700))
      const screenshot = await window.webContents.capturePage()
      fs.writeFileSync('/tmp/dovo-ux-pairing.png', screenshot.toPNG())
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' })
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' })
      for (const label of ['Overview', 'Tasks', 'Settings']) {
        await window.webContents.executeJavaScript(`(async () => {
          const nav = document.querySelector('nav[aria-label="Main navigation"]')
          const button = [...nav.querySelectorAll('button')].find(item => item.getAttribute('aria-label') === ${JSON.stringify(label)})
          if (!button) throw new Error('Missing navigation label')
          button.click()
          for (let i = 0; i < 50; i++) {
            if (!document.body.innerText.includes('Loading extension…')) return
            await new Promise(resolve => setTimeout(resolve, 100))
          }
          throw new Error('Navigation failed')
        })()`)
        await new Promise((resolve) => setTimeout(resolve, 300))
        fs.writeFileSync(
          `/tmp/dovo-ui-${label.toLowerCase()}.png`,
          (await window.webContents.capturePage()).toPNG(),
        )
      }
      window.setSize(900, 760)
      await new Promise((resolve) => setTimeout(resolve, 300))
      await window.webContents.executeJavaScript(`(() => {
        if (document.documentElement.scrollWidth > window.innerWidth) throw new Error('Compact workspace overflows horizontally')
        const label = document.querySelector('.studio-navigation-label')
        if (getComputedStyle(label).display !== 'none') throw new Error('Compact navigation must use the labeled tooltips')
      })()`)
      fs.writeFileSync('/tmp/dovo-ui-compact.png', (await window.webContents.capturePage()).toPNG())
      window.setSize(1180, 760)
      const stalledAddress = `http://127.0.0.1:${stalled.address().port}`
      await window.webContents.executeJavaScript(`(async () => {
        const saved = JSON.parse(await window.dovo.readRuntimeRegistry())
        saved.pendingPairings = [{ profile: { id: ${JSON.stringify(stalledAddress)}, name: 'Offline test computer', connection: { address: ${JSON.stringify(stalledAddress)}, token: 'synthetic-stalled-pairing-token' } }, proof: { id: 'stalled', secret: 'synthetic-stalled-proof-secret', expiresAt: new Date(Date.now() + 120000).toISOString() } }]
        await window.dovo.writeRuntimeRegistry(JSON.stringify(saved))
      })()`)
      const started = Date.now()
      await new Promise((resolve) => {
        window.webContents.once('did-finish-load', resolve)
        window.webContents.reload()
      })
      await window.webContents.executeJavaScript(`(async () => {
        for (let i = 0; i < 30; i++) {
          if (document.body.innerText.includes('Workspace synced')) return
          await new Promise(resolve => setTimeout(resolve, 100))
        }
        throw new Error('Pending pairing blocked the saved workspace')
      })()`)
      if (Date.now() - started >= 4500) throw new Error('Startup waited for pairing recovery')
      console.log(
        'Pairing UX passed: loopback-to-LAN setup, restart preference persistence, address selection, QR image, manual code, countdown, host approval, confirmation and nonblocking recovery.',
      )
      app.quit()
    } catch (error) {
      console.error(error)
      exitCode = 1
      app.quit()
    }
  })
})
setTimeout(() => {
  console.error('Pairing UX timeout')
  exitCode = 1
  app.quit()
}, 45000).unref()
import(path.resolve(__dirname, '../apps/desktop/dist-electron/main.js')).catch((error) => {
  console.error(error)
  exitCode = 1
  app.quit()
})
