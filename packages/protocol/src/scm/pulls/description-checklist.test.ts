import { expect, it } from 'vite-plus/test'
import { pullDescriptionTasks, togglePullDescriptionTask } from './description-checklist'

it('toggles a checklist marker at its source offset after a leading BOM', () => {
  const source = '\uFEFF- [ ] Ready'
  const [task] = pullDescriptionTasks(source)
  expect(task).toMatchObject({ offset: source.indexOf('[ ]') + 1, checked: false })
  expect(togglePullDescriptionTask(source, task!, true)).toBe('\uFEFF- [x] Ready')
})

it('toggles the exact item when descriptions contain identical task labels', () => {
  const source = '- [ ] **Review**\n- [ ] **Review**\n\n```md\n- [ ] Example\n```'
  const tasks = pullDescriptionTasks(source)
  expect(tasks.map((task) => task.label)).toEqual(['Review', 'Review'])
  expect(togglePullDescriptionTask(source, tasks[0]!, true)).toBe(
    '- [x] **Review**\n- [ ] **Review**\n\n```md\n- [ ] Example\n```',
  )
  expect(togglePullDescriptionTask(source, tasks[1]!, true)).toBe(
    '- [ ] **Review**\n- [x] **Review**\n\n```md\n- [ ] Example\n```',
  )
})

it.each(['\r', '\r\n', '\n'])('toggles a nested checklist marker on the next line (%j)', (eol) => {
  const source = `> > 1.${eol}> >    [X] Ready`
  const tasks = pullDescriptionTasks(source)
  expect(tasks).toHaveLength(1)
  expect(tasks[0]).toMatchObject({ checked: true, label: 'Ready' })
  expect(togglePullDescriptionTask(source, tasks[0]!, false)).toBe(`> > 1.${eol}> >    [ ] Ready`)
})
