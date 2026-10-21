import assert from 'node:assert/strict'

/** Exercise local interactions in the shared React Native web catalog stories. */
export async function checkMobileSettingsAndThreads(page, origin) {
  const openStory = async (id) => {
    await page.goto(`${origin}/iframe.html?id=${id}&viewMode=story&globals=theme:dark`)
    await page.locator('#storybook-root > *').first().waitFor()
  }

  await openStory('dovo-mobile-settings--settings-navigation-and-editor')
  await page.getByRole('button', { name: 'Runtime address', exact: true }).click()
  const address = page.getByRole('textbox', { name: 'Runtime address', exact: true })
  await address.waitFor()
  await address.fill('http://vpn.example.test:51464')
  await page.getByRole('button', { name: 'Make next save fail', exact: true }).click()
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'could not save this setting' }).waitFor()
  assert.equal(await address.inputValue(), 'http://vpn.example.test:51464')

  await page.getByRole('button', { name: 'Retry save', exact: true }).click()
  await page.getByText('Saved in this local preview for this device.', { exact: true }).waitFor()

  await address.fill('http://discarded.example.test:51464')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Runtime address', exact: true }).waitFor()
  await page.getByText('http://vpn.example.test:51464', { exact: true }).waitFor()
  assert.equal(
    await page.getByText('http://discarded.example.test:51464', { exact: true }).count(),
    0,
  )

  await page.getByRole('button', { name: 'Runtime address', exact: true }).click()
  await page.getByRole('button', { name: 'Forget saved connection', exact: true }).click()
  const confirmation = page.getByRole('dialog', { name: 'Forget saved connection?', exact: true })
  await confirmation.waitFor()
  await confirmation
    .getByText('This clears the address from this local preview.', { exact: false })
    .waitFor()
  const cancelConfirmation = confirmation.getByRole('button', { name: 'Cancel', exact: true })
  const cancelBox = await cancelConfirmation.boundingBox()
  assert.ok(cancelBox && cancelBox.height >= 44, 'Confirmation cancel action must be a 44px target')
  await cancelConfirmation.click()
  await confirmation.waitFor({ state: 'hidden' })

  await page.getByRole('button', { name: 'Forget saved connection', exact: true }).click()
  const confirmAgain = page.getByRole('dialog', {
    name: 'Forget saved connection?',
    exact: true,
  })
  await confirmAgain.waitFor()
  await confirmAgain
    .getByText('This clears the address from this local preview.', { exact: false })
    .waitFor()
  const forgetConfirmation = confirmAgain.getByRole('button', {
    name: 'Forget saved connection',
    exact: true,
  })
  const forgetBox = await forgetConfirmation.boundingBox()
  assert.ok(forgetBox && forgetBox.height >= 44, 'Confirmation action must be a 44px target')
  await forgetConfirmation.click()
  await confirmAgain.waitFor({ state: 'hidden' })
  const clearedAddress = page.getByRole('textbox', { name: 'Runtime address', exact: true })
  await clearedAddress.waitFor()
  assert.equal(await clearedAddress.inputValue(), '')
  await page.getByRole('button', { name: 'Back to settings', exact: true }).click()
  await page.getByRole('button', { name: 'Runtime address', exact: true }).waitFor()
  await page.getByText('Not configured', { exact: true }).waitFor()

  await openStory('dovo-mobile-settings--settings-loading')
  await page.getByText('Saving this setting in the local preview…', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Complete local save', exact: true }).click()
  await page.getByText('Saved in this local preview for this device.', { exact: true }).waitFor()

  await openStory('dovo-mobile-settings--settings-error-and-retry')
  await page
    .getByRole('alert')
    .filter({ hasText: 'The local preview could not save this setting' })
    .waitFor()
  assert.equal(
    await page.getByRole('textbox', { name: 'Runtime address', exact: true }).inputValue(),
    'http://studio.local:51464',
  )
  await page.getByRole('button', { name: 'Retry save', exact: true }).click()
  await page.getByText('Saved in this local preview for this device.', { exact: true }).waitFor()

  await openStory('dovo-mobile-thread-activity--deep-thread-tree')
  const summary = page.getByRole('button', {
    name: 'Spawned threads for Improve the connection settings flow',
    exact: true,
  })
  await summary.waitFor()
  assert.equal(await summary.getAttribute('aria-expanded'), 'true')
  await summary.click()
  assert.equal(await summary.getAttribute('aria-expanded'), 'false')
  await summary.click()
  assert.equal(await summary.getAttribute('aria-expanded'), 'true')

  const finished = page.getByRole('button', {
    name: 'Finished threads for Improve the connection settings flow',
    exact: true,
  })
  await finished.waitFor()
  assert.equal(await finished.getAttribute('aria-expanded'), 'false')
  await finished.click()
  assert.equal(await finished.getAttribute('aria-expanded'), 'true')
  await page.getByText('Finish the local settings fixture', { exact: true }).waitFor()

  await page.getByRole('button', { name: 'Acknowledge failure', exact: true }).click()
  await page
    .getByRole('button', { name: 'Acknowledge failure', exact: true })
    .waitFor({ state: 'hidden' })
  await page.getByText('Check the stale cached-data edge case', { exact: true }).waitFor()
}
