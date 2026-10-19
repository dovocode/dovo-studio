import { relatedFileGroups } from './order-analysis.js'
import { readReviewAnalysis, reviewAnalysisMaxBytes } from './order-input.js'

// A separate process is deliberate: fatal native/Wasm OOMs also kill Worker threads' host.
// The parent applies a deadline and SIGKILL. No database, runtime or agent services run here.
async function main() {
  let bytes = 0
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += data.length
    // JSON escaping can expand text by up to six times.
    if (bytes > reviewAnalysisMaxBytes * 6) throw new Error('Review analysis input is too large')
    chunks.push(data)
  }
  const { files, modules } = readReviewAnalysis(JSON.parse(Buffer.concat(chunks).toString('utf8')))
  const groups = await relatedFileGroups(files, modules)
  process.stdout.write(JSON.stringify(groups))
}

main().catch((error: unknown) => {
  // Source contents and validation errors must never be copied into diagnostics.
  console.error(error instanceof Error ? error.name : 'Review analysis failed')
  process.exitCode = 1
})
