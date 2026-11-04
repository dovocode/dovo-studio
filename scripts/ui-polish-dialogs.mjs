import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

// These open production follow-up UI. No final submit, destructive action or runtime write is run.
export async function captureFollowUpDialogs(page, origin, output) {
  page.setDefaultTimeout(6000)
  const button = (name) => page.getByRole('button', { name, exact: true })
  const menu = (name) => page.getByRole('menuitem', { name, exact: true })
  const info = async () => {
    const show = button('Show thread info')
    if (await show.count()) await show.click()
    await page.getByRole('dialog', { name: 'Thread info', exact: true }).waitFor()
  }
  const projectAction = (name) => async () => {
    await info()
    await button('Project actions').click()
    await menu(name).click()
  }
  const threadAction = (name) => async () => {
    await button('Thread actions').first().click()
    await menu(name).click()
  }
  const prAction = (name) => async () => {
    await button('PR actions').click()
    await menu(name).click()
  }
  /** @type {Array<[string, string, () => Promise<void>]>} */
  const scenarios = [
    [
      'project-actions-menu',
      'tasks',
      async () => {
        await info()
        await button('Project actions').click()
      },
    ],
    ['project-actions', 'tasks', projectAction('Edit project actions…')],
    [
      'project-actions-validation',
      'tasks',
      async () => {
        await projectAction('Edit project actions…')()
        await page
          .getByRole('dialog', { name: 'Project actions', exact: true })
          .getByRole('button', { name: 'Save', exact: true })
          .click()
      },
    ],
    [
      'project-actions-discard',
      'tasks',
      async () => {
        await projectAction('Edit project actions…')()
        const dialog = page.getByRole('dialog', { name: 'Project actions', exact: true })
        await dialog.getByRole('textbox', { name: 'Command', exact: true }).fill('pnpm test')
        let message = ''
        page.once('dialog', async (native) => {
          message = native.message()
          await native.dismiss()
        })
        await dialog.getByRole('button', { name: 'Cancel', exact: true }).click()
        await dialog.waitFor()
        assert.match(message, /discard/i)
      },
    ],
    ['saved-prompts', 'tasks', projectAction('Edit saved prompts…')],
    ['task-templates', 'tasks', projectAction('Manage task templates…')],
    ['approval-rules', 'tasks', projectAction('Manage approval rules…')],
    ['project-instructions', 'tasks', projectAction('Edit project instructions…')],
    [
      'open-in-menu',
      'tasks',
      async () => {
        await info()
        await button('Open in…').click()
      },
    ],
    [
      'branch-move',
      'tasks',
      async () => {
        await info()
        await page
          .getByRole('dialog', { name: 'Thread info', exact: true })
          .getByRole('button', { name: /main/ })
          .click()
        await menu('Move to its own worktree…').click()
      },
    ],
    [
      'branch-menu',
      'tasks',
      async () => {
        await info()
        await page
          .getByRole('dialog', { name: 'Thread info', exact: true })
          .getByRole('button', { name: /main/ })
          .click()
      },
    ],
    [
      'git-actions-menu',
      'tasks',
      async () => {
        await info()
        await button('Git actions and pull requests').click()
      },
    ],
    [
      'git-actions',
      'tasks',
      async () => {
        await info()
        await button('Git actions and pull requests').click()
        await menu('Advanced Git actions…').click()
      },
    ],
    ['thread-rename', 'tasks', threadAction('Rename…')],
    ['thread-delete', 'tasks', threadAction('Delete thread…')],
    [
      'thread-template',
      'tasks',
      async () => {
        await button('Thread actions').first().click()
        await menu('New thread').focus()
        await page.keyboard.press('ArrowRight')
        await menu('Save as template…').click()
      },
    ],
    [
      'pr-create',
      'pulls',
      async () => {
        await button('Create pull request').click()
      },
    ],
    ['pr-review', 'pull-overview', prAction('Submit review')],
    ['pr-merge', 'pull-overview', prAction('Merge pull request')],
    ['pr-edit', 'pull-overview', prAction('Edit pull request')],
    ['pr-close', 'pull-overview', prAction('Close pull request')],
    ['pr-draft', 'pull-overview', prAction('Convert to draft')],
    ['pr-auto-merge', 'pull-overview', prAction('Enable auto-merge')],
    ['pr-comment', 'pull-overview', prAction('Comment on PR')],
    [
      'pr-add-to-thread',
      'pulls',
      async () => {
        await button('Actions for PR #42').click()
        await menu('Add to thread').click()
      },
    ],
    [
      'new-automation',
      'jobs',
      async () => {
        await button('New automation').click()
      },
    ],
    ['pr-reviewers', 'pull-overview', prAction('Manage reviewers')],
    [
      'add-skill',
      'resources',
      async () => {
        await button('Add skill').click()
      },
    ],
    [
      'add-mcp',
      'resources',
      async () => {
        await button('Add MCP server').click()
      },
    ],

    [
      'pair-computer',
      'runtime',
      async () => {
        await button('Connect computer').click()
      },
    ],
    [
      'licenses',
      'updates-settings',
      async () => {
        await button('View notices').click()
      },
    ],
  ]
  const direct = [
    'command-palette',
    'project-delete',
    'forge-connections',
    'import-codex',
    'import-pi',
    'downloads',
    'issue-create',
    'issue-edit',
    'issue-comment',
    'pipeline-run',
    'artifact-actions',
    'terminal-close',
    'terminal-close-multiple',
    'undo',
    'new-session',
    'undo-error',
    'harness',
    'link-pr',
    'repository-local',
    'repository-github',
    'repository-forge',
    'source-picker',
    'project-transfer',
    'jira-sources',
    'artifact-export',
    'website-customization',
    'thread-context',
    'draft-stash',
    'section-order',
    'local-commits',
    'browser-history',
    'browser-bookmarks',
    'image-preview',
    'image-editor',
    'add-agent',
    'edit-agent',
    'pr-ask-agent',
  ]
  /** @type {Record<string, string>} */
  const directTriggers = {
    'project-delete': 'Delete Dovo Studio…',
    'forge-connections': 'Connections',
    'import-codex': 'Import Codex terminal session',
    'import-pi': 'Import Pi terminal session',
    downloads: 'Downloads',
    'artifact-actions': 'Delete artifact Workspace notes',
    'image-editor': 'Edit sample image',
    'image-preview': 'Preview workspace.png',
    'thread-context': 'Attach thread context',
    'draft-stash': 'Stashed drafts',
    'section-order': 'Organize sections',
    'local-commits': 'Local commits',
  }
  for (const name of direct)
    scenarios.push([
      name,
      `dialog:${name}`,
      async () => {
        if (directTriggers[name]) await button(directTriggers[name]).last().click()
        await page.getByRole('dialog').last().waitFor()
        if (name === 'image-editor')
          await page
            .frameLocator('iframe[title="Image editor"]')
            .getByRole('button', { name: 'Attach image', exact: true })
            .waitFor({ state: 'visible' })
        if (name === 'local-commits')
          await page.getByText('Loading commits…', { exact: true }).waitFor({ state: 'hidden' })
      },
    ])
  const results = []
  for (const mode of ['dark', 'light'])
    for (const [name, route, open] of scenarios) {
      if (
        process.argv.some((arg) => arg.startsWith('--dialog-only=')) &&
        !process.argv
          .find((arg) => arg.startsWith('--dialog-only='))
          .slice(14)
          .split(',')
          .includes(name)
      )
        continue
      try {
        const target = route.startsWith('dialog:')
          ? `tasks&thread=preview-task&dialog=${route.slice(7)}`
          : route.startsWith('pull-')
            ? `pulls&surface=${route}`
            : route === 'tasks'
              ? 'tasks&thread=preview-task'
              : route
        await page.goto(`${origin}/?mode=${mode}&route=${target}&idle=1`)
        await page.locator('.studio').waitFor()
        await page.waitForFunction(() => !document.body.innerText.includes('Loading extension…'))
        if (route === 'tasks')
          await page.getByRole('textbox', { name: 'Message task', exact: true }).waitFor()
        await open()
        await page.waitForFunction(
          () => !document.body.innerText.includes('Loading provider models…'),
        )
        await page.evaluate(() => document.fonts.ready)
        await page.waitForFunction(() =>
          document
            .getAnimations()
            .every(
              (a) =>
                a.effect?.getComputedTiming().iterations === Infinity ||
                ['finished', 'idle', 'paused'].includes(a.playState),
            ),
        )
        const dialogs = page.getByRole('dialog')
        assert.ok(
          (await dialogs.count()) || (await page.getByRole('menu').count()),
          `${name} opens a dialog or menu`,
        )
        for (const dialog of await dialogs.all()) {
          const box = await dialog.boundingBox()
          assert.ok(
            box.x >= 0 && box.y >= 0 && box.x + box.width <= 1441 && box.y + box.height <= 961,
            `${name}: dialog fits viewport`,
          )
          assert.ok(
            await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
            `${name}: no horizontal clipping`,
          )
        }
        await page.mouse.move(0, 0)
        await page.screenshot({
          path: resolve(output, `${name}-${mode}.png`),
          animations: 'disabled',
        })
        results.push({ name, mode, route, text: await page.locator('body').innerText() })
        console.log(`dialog ${name}-${mode}: captured`)
        if (name === 'image-editor') {
          const frame = page.frameLocator('iframe[title="Image editor"]')
          await frame.locator('#attach:enabled').waitFor()
          await frame.getByRole('button', { name: 'Arrow', exact: true }).click()
          const box = await frame.locator('canvas').boundingBox()
          await page.mouse.move(box.x + box.width * 0.2, box.y + box.height * 0.45)
          await page.mouse.down()
          await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.45, { steps: 10 })
          await page.mouse.up()
          await page.screenshot({ path: resolve(output, `image-editor-annotated-${mode}.png`) })
          await frame.getByRole('button', { name: 'Crop', exact: true }).click()
          await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.1)
          await page.mouse.down()
          await page.mouse.move(box.x + box.width * 0.9, box.y + box.height * 0.9, { steps: 10 })
          await page.screenshot({ path: resolve(output, `image-editor-crop-${mode}.png`) })
          await page.mouse.up()
          await frame.getByText('Keyboard shortcuts', { exact: true }).click()
          await page.screenshot({ path: resolve(output, `image-editor-shortcuts-${mode}.png`) })
          await frame.getByRole('button', { name: 'Cancel', exact: true }).click()
        } else if (name === 'add-agent') {
          const dialog = page.getByRole('dialog').last()
          await dialog.getByRole('button', { name: 'Next', exact: true }).click()
          await page.screenshot({ path: resolve(output, `add-agent-profile-${mode}.png`) })
          await dialog.getByRole('button', { name: 'Next', exact: true }).click()
          await page.waitForFunction(
            () => !document.body.innerText.includes('Loading provider models…'),
          )
          const completion = dialog.getByRole('button', { name: 'Add configuration', exact: true })
          const completionBox = await completion.boundingBox()
          const dialogBox = await dialog.boundingBox()
          assert.ok(
            completionBox &&
              dialogBox &&
              completionBox.y >= dialogBox.y &&
              completionBox.y + completionBox.height <= dialogBox.y + dialogBox.height,
            'Agent setup completion stays inside the dialog viewport',
          )
          await page.screenshot({ path: resolve(output, `add-agent-model-${mode}.png`) })
          await page.keyboard.press('Escape')
        } else await page.keyboard.press('Escape')
      } catch (error) {
        results.push({
          name,
          mode,
          route,
          error: error.message,
          text: await page.locator('body').innerText(),
          controls: await page.locator('button, [role="menuitem"]').allTextContents(),
        })
        console.log(`dialog ${name}-${mode}: ${error.message.split('\n')[0]}`)
      }
      await writeFile(resolve(output, 'dialogs-manifest.json'), JSON.stringify(results, null, 2))
    }
  await writeFile(resolve(output, 'dialogs-manifest.json'), JSON.stringify(results, null, 2))
  assert.equal(
    results.filter((row) => row.error).length,
    0,
    'All follow-up scenarios must open successfully; see dialogs-manifest.json',
  )
}
