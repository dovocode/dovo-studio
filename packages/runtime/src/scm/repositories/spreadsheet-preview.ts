import { Worker } from 'node:worker_threads'
import { createRequire } from 'node:module'
import { decode, spreadsheetPreviewSchema, type SpreadsheetPreview } from '@dovo/protocol'
import { HttpError } from '../../errors.js'
const require = createRequire(import.meta.url)
// Parse untrusted workbooks away from the runtime event loop. No macros or formulas execute.
const source = `
const { parentPort, workerData } = require('node:worker_threads');
try {
  const XLSX = require(workerData.parser);
  const data = Buffer.from(workerData.data);
  if (data[0] === 80 && data[1] === 75) {
    let total = 0;
    require(workerData.zip).unzipSync(data, {filter(entry) {
      total += entry.originalSize;
      if (total > 32 * 1024 * 1024) throw Error('Expanded workbook exceeds 32 MB.');
      return false;
    }});
  }
  const sheets = XLSX.read(data, {type:'buffer',bookSheets:true}).SheetNames;
  if (sheets.length > 100) throw Error('Workbooks support at most 100 sheets.');
  const sheet = workerData.sheet || sheets[0];
  if (!sheets.includes(sheet)) throw Error('Worksheet not found.');
  const workbook = XLSX.read(data, {type:'buffer',sheets:[sheet],sheetRows:201,cellFormula:false,cellHTML:false,cellStyles:false});
  const ws = workbook.Sheets[sheet];
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  const original = XLSX.utils.decode_range(ws['!fullref'] || ws['!ref'] || 'A1');
  let clipped = false, remaining = 500000;
  const rows = XLSX.utils.sheet_to_json(ws, {header:1,raw:false,defval:'',blankrows:true,
    range:{s:{r:0,c:0},e:{r:Math.min(range.e.r,199),c:Math.min(range.e.c,49)}}})
    .map(row => Array.from({length:Math.min(range.e.c+1,50)}, (_,i) => (() => { const value = String(row[i] ?? ''); const result = value.slice(0,Math.min(2000,remaining)); remaining -= result.length; if(result.length < value.length) clipped = true; return result; })()));
  parentPort.postMessage({result:{sheets,sheet,rows,truncated:clipped || original.e.r>=200 || original.e.c>=50}});
} catch(error) { parentPort.postMessage({error:error.message}); }
`
export function spreadsheetPreview(data: Uint8Array, sheet?: string) {
  if (data.byteLength > 8 * 1024 * 1024)
    throw new HttpError(413, 'Spreadsheet previews support files up to 8 MB.')
  return new Promise<SpreadsheetPreview>((resolve, reject) => {
    const worker = new Worker(source, {
      eval: true,
      workerData: { data, sheet, parser: require.resolve('xlsx'), zip: require.resolve('fflate') },
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 },
    })
    let settled = false
    const done = (error?: Error, result?: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      void worker.terminate()
      if (error) reject(error)
      else
        try {
          resolve(decode(spreadsheetPreviewSchema, result))
        } catch (cause) {
          reject(cause)
        }
    }
    const timer = setTimeout(
      () => done(new HttpError(408, 'Spreadsheet preview timed out.')),
      10000,
    )
    worker.once('error', (error: unknown) =>
      done(error instanceof Error ? error : new Error(String(error))),
    )
    worker.once('exit', (code) => {
      if (code) done(new Error('Spreadsheet parser stopped before completing.'))
    })
    worker.once('message', (value: unknown) => {
      if (value && typeof value === 'object' && 'error' in value && typeof value.error === 'string')
        done(new HttpError(422, value.error))
      else if (value && typeof value === 'object' && 'result' in value)
        done(undefined, value.result)
      else done(new Error('Invalid spreadsheet preview.'))
    })
  })
}
