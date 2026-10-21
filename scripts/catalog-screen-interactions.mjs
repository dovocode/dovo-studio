import assert from 'node:assert/strict'

/** Lazy screen controllers must finish mounting before transition and accessibility checks. */
export async function waitForCatalogScreen(page, storyId) {
  if (!storyId.startsWith('dovo-screens-desktop') || storyId.endsWith('--workspace-loading')) return
  await page.locator('#storybook-root').waitFor()
  await page.waitForFunction(() => {
    const root = document.querySelector('#storybook-root')
    return (
      root?.children.length && !/Loading extension…|Opening workspace…/.test(root.textContent ?? '')
    )
  })
  const content = {
    'dovo-screens-desktop-detail-and-overlays--selected-issue':
      'Please compare the narrow layout as well.',
    'dovo-screens-desktop-detail-and-overlays--selected-issue-page':
      'Please compare the narrow layout as well.',
    'dovo-screens-desktop-detail-and-overlays--selected-pipeline-page':
      'The narrow sidebar exceeds its container.',
  }[storyId]
  if (content) await page.getByText(content, { exact: false }).first().waitFor()
}

/** Exercise real screen compositions against synthetic, disconnected catalog providers. */
export async function checkScreenInteractions(page, origin) {
  const requests = []
  const errors = []
  const captureRequest = (request) => {
    const url = new URL(request.url())
    if (
      ['http:', 'https:'].includes(url.protocol) &&
      (url.origin !== new URL(origin).origin || url.pathname.startsWith('/api/'))
    )
      requests.push(`${request.method()} ${url.origin}${url.pathname}`)
  }
  const captureError = (error) => errors.push(error.message)
  page.on('request', captureRequest)
  page.on('pageerror', captureError)
  const open = async (id) => {
    await page.goto(`${origin}/iframe.html?id=${id}&viewMode=story&globals=theme:dark`)
    await page.locator('#storybook-root').waitFor()
  }
  const visible = async (text) => {
    await page.getByText(text, { exact: false }).first().waitFor({ state: 'visible' })
  }
  let checks = 0
  try {
    await page.setViewportSize({ width: 1280, height: 900 })
    await open('dovo-screens-desktop--tasks')
    const navigation = page.getByRole('navigation', { name: 'Main navigation' })
    const selected = navigation.locator('button[aria-current="page"]')
    await selected.waitFor()
    assert.equal(await selected.getAttribute('aria-expanded'), 'true')
    await selected.click()
    assert.equal(await selected.getAttribute('aria-expanded'), 'false')
    await selected.click()
    assert.equal(await selected.getAttribute('aria-expanded'), 'true')
    await navigation.getByRole('button', { name: 'Issues', exact: true }).click()
    await page.getByRole('main', { name: 'Issues page' }).waitFor()
    await visible('Unify sidebar selection and page headers')
    await navigation.getByRole('button', { name: 'Pull requests', exact: true }).click()
    await page.getByRole('main', { name: 'Pull requests page' }).waitFor()
    await visible('Keep Dovo navigation consistent')
    checks += 3
    await open('dovo-screens-desktop--pipelines')
    await visible('Verify consistent UI components')
    checks++

    for (const [id, content] of [
      ['selected-pull-page', 'Requested reviewers'],
      ['selected-issue-page', 'Please compare the narrow layout as well.'],
      ['selected-pipeline-page', 'The narrow sidebar exceeds its container.'],
    ]) {
      await open(`dovo-screens-desktop-detail-and-overlays--${id}`)
      await visible(content)
      if (id === 'selected-issue-page') {
        const completed = page.getByRole('checkbox', { name: 'Define tokens', exact: true })
        const pending = page.getByRole('checkbox', {
          name: 'Review screen compositions',
          exact: true,
        })
        assert.equal(await completed.isChecked(), true)
        assert.equal(await pending.isChecked(), false)
        assert.equal(await completed.isDisabled(), true)
        assert.equal(await pending.isDisabled(), true)
      }
      checks++
    }

    await open('dovo-screens-desktop--jira')
    await page.getByRole('button', { name: 'Filters', exact: true }).click()
    const statusFilters = page.getByRole('group', { name: 'Status category' })
    await statusFilters.getByRole('button', { name: 'Done', exact: true }).click()
    await page.keyboard.press('Escape')
    const activeFilters = page.getByRole('group', { name: 'Active Jira filters' })
    await activeFilters.getByRole('button', { name: /Done/ }).waitFor()
    await page.getByRole('region', { name: 'Jira issue results' }).waitFor({ state: 'attached' })
    await open('dovo-screens-desktop--usage')
    await page
      .getByRole('img', { name: /No usage/ })
      .first()
      .waitFor()
    await open('dovo-screens-desktop--appearance')
    const terminalPreview = page.getByRole('region', { name: 'Terminal font preview' })
    await terminalPreview.focus()
    assert.equal(await terminalPreview.evaluate((node) => node === document.activeElement), true)
    await open('dovo-screens-desktop--shortcuts')
    const shortcuts = page.getByRole('region', { name: 'Keyboard shortcuts settings' })
    await shortcuts.focus()
    await shortcuts.press('End')
    await page.waitForFunction(() => {
      const region = document.querySelector('[aria-label="Keyboard shortcuts settings"]')
      return region && region.scrollTop > 0
    })
    checks += 4

    await open('dovo-screens-desktop--runtime')
    await page.getByRole('button', { name: 'Check updates', exact: true }).waitFor()
    await page.waitForFunction(() =>
      [...document.querySelectorAll('[role="button"],button')].some(
        (node) =>
          node.textContent === 'Check updates' && node.getAttribute('aria-disabled') !== 'true',
      ),
    )
    checks++
    await page.setViewportSize({ width: 390, height: 900 })
    await open('dovo-screens-mobile--full-composer')
    await visible('Full native composer')
    const input = page.getByRole('textbox').first()
    await input.waitFor()
    await input.fill('Compare the mobile sidebar and preserve this local draft.')
    await input.blur()
    assert.equal(
      await input.inputValue(),
      'Compare the mobile sidebar and preserve this local draft.',
      'The complete mobile composer must retain an editable local draft while disconnected',
    )
    const send = page.getByRole('button', { name: 'Send', exact: true })
    assert.equal(await send.isDisabled(), true, 'Disconnected catalog composer must not send')
    await input.fill('')
    checks++
    assert.deepEqual(errors, [], 'Screen compositions must not throw browser errors')
    assert.deepEqual(requests, [], 'Catalog screen interactions must not contact live services')
    return checks
  } finally {
    page.off('request', captureRequest)
    page.off('pageerror', captureError)
  }
}
