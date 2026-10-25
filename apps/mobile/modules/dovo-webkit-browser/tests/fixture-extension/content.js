// Runs in WebKit's extension isolated world. Records what it can see on the page's DOM.
;(async () => {
  const root = document.documentElement
  root.dataset.dovoPageGlobalSeenByContent = typeof window.__dovoPageGlobal
  window.__dovoContentGlobal = 'content'
  const { count = 0 } = await browser.storage.local.get('count')
  await browser.storage.local.set({ count: count + 1 })
  root.dataset.dovoCount = String(count + 1)
  root.dataset.dovoChromeAlias = typeof chrome?.runtime?.id
  root.dataset.dovoFixture = 'injected'
  const banner = document.createElement('div')
  banner.id = 'dovo-fixture-banner'
  banner.textContent = `Dovo fixture content script · storage.local count ${count + 1} · page global seen: ${root.dataset.dovoPageGlobalSeenByContent}`
  banner.style.cssText =
    'position:fixed;left:0;right:0;bottom:0;padding:16px;font:600 18px system-ui;background:#0a7d32;color:#fff;z-index:2147483647'
  document.body.append(banner)
})().catch((error) => {
  document.documentElement.dataset.dovoFixtureError = String(error)
})
