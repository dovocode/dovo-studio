;(async () => {
  const body = document.body
  const { count = 0 } = await browser.storage.local.get('count')
  body.dataset.count = String(count)
  body.dataset.sendNativeMessage = typeof browser.runtime.sendNativeMessage
  body.dataset.windowsCreate = typeof browser.windows?.create
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  body.dataset.activeTabUrl = tab?.url ?? 'none'
  body.dataset.ready = '1'
})().catch((error) => {
  document.body.dataset.error = String(error)
  document.body.dataset.ready = '1'
})
