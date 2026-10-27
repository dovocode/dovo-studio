import { appendFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'

/** Record expensive packaging stages without changing what they do or how they fail. */
export function createTiming({ now = () => performance.now(), log = console.log } = {}) {
  const stages = []
  const start = (label) => {
    const began = now()
    let done = false
    return (outcome = 'ok') => {
      if (done) return
      done = true
      const seconds = (now() - began) / 1000
      stages.push({ label, seconds, outcome })
      log(`[timing] ${label}: ${seconds.toFixed(1)}s${outcome === 'ok' ? '' : ` (${outcome})`}`)
    }
  }
  const measure = async (label, task) => {
    const end = start(label)
    try {
      const result = await task()
      end()
      return result
    } catch (error) {
      end('failed')
      throw error
    }
  }
  /** Time an instance method in place; the original receives the same this, arguments and result. */
  const wrap = (target, method, label) => {
    const original = target?.[method]
    if (typeof original !== 'function' || original.dovoTimed) return
    const timed = function (...args) {
      return measure(label, () => original.apply(this, args))
    }
    timed.dovoTimed = true
    target[method] = timed
  }
  const summary = () =>
    [
      '| Packaging stage | Duration | Outcome |',
      '| --- | ---: | --- |',
      ...stages.map(
        ({ label, seconds, outcome }) => `| ${label} | ${seconds.toFixed(1)}s | ${outcome} |`,
      ),
    ].join('\n')
  const report = (file = process.env.GITHUB_STEP_SUMMARY) => {
    if (file && stages.length) appendFileSync(file, `\n${summary()}\n`)
  }
  return { stages, start, measure, wrap, summary, report }
}

/**
 * electron-builder signs and then notarizes inside one MacPackager.sign() call, before afterSign.
 * Wrap the two installed instance methods it calls so each phase is reported separately.
 */
export function timeMacSigning(timing, packager) {
  timing.wrap(packager, 'doSign', 'Mac code signing')
  timing.wrap(packager?.helper, 'notarizeIfProvided', 'Mac notarization')
}
