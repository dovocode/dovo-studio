import { performance } from 'node:perf_hooks'
import {
  FreezeProfiles,
  captureFreezeProfile,
} from '../packages/runtime/dist/diagnostics/freeze-profiles.js'
const disabled = new FreezeProfiles(() => false)
const count = 500000
let start = performance.now()
for (let i = 0; i < count; i++) disabled.sample(0, 0)
const disabledNs = ((performance.now() - start) * 1e6) / count
disabled.dispose()
function workload() {
  const start = performance.now()
  let value = 0
  for (let i = 1; i <= 10000000; i++) value += Math.sqrt(i)
  return { ms: performance.now() - start, value }
}
workload()
const baseline = Array.from({ length: 5 }, workload).map((run) => run.ms)
const keepAlive = setInterval(() => {}, 1000)
const capture = captureFreezeProfile(new AbortController().signal)
await new Promise((resolve) => setTimeout(resolve, 20))
const sampled = Array.from({ length: 5 }, workload).map((run) => run.ms)
const summary = await capture.finally(() => clearInterval(keepAlive))
const mean = (values) => values.reduce((sum, value) => sum + value, 0) / values.length
console.log(
  JSON.stringify(
    {
      disabledSampleNs: disabledNs,
      baselineMeanMs: mean(baseline),
      profiledMeanMs: mean(sampled),
      ratio: mean(sampled) / mean(baseline),
      durationMs: summary.durationMs,
      samples: summary.samples,
      retainedFunctions: summary.functions.length,
      scope:
        'Synthetic numeric loop in one Linux Node process. Not end-user latency or native UI profiling.',
    },
    null,
    2,
  ),
)
