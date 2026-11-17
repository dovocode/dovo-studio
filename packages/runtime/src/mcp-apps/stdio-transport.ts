import {
  StdioClientTransport,
  type StdioServerParameters,
} from '@modelcontextprotocol/sdk/client/stdio.js'
import { StringDecoder } from 'node:string_decoder'
import { stripVTControlCharacters } from 'node:util'
import { diagnosticMessage } from '@dovo/protocol'
import { environmentSecrets, redactReportText } from '../diagnostics/report-redaction.js'

/** Drain continuously, but retain only a bounded tail for a failed connection. */
export class DiagnosticStdioTransport extends StdioClientTransport {
  private tail = ''
  private cut = false
  private ended: Promise<void>
  private secrets: string[]
  constructor(parameters: StdioServerParameters) {
    super({ ...parameters, stderr: 'pipe' })
    this.secrets = [...environmentSecrets(), ...Object.values(parameters.env ?? {})].filter(Boolean)
    const decoder = new StringDecoder('utf8')
    const keep = (text: string) => {
      this.tail += text
      if (this.tail.length > 16384) {
        this.cut = true
        this.tail = this.tail.slice(-16384)
      }
    }
    this.ended = new Promise((resolve) => {
      const stream = this.stderr
      if (!stream) return resolve()
      stream.on('data', (chunk: Buffer) => keep(decoder.write(chunk)))
      stream.once('end', () => {
        keep(decoder.end())
        resolve()
      })
      stream.once('close', () => resolve())
      stream.once('error', () => resolve())
    })
  }
  async explain(error: unknown): Promise<unknown> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        this.ended,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, 250)
        }),
      ])
    } finally {
      clearTimeout(timer)
    }
    // Drop a partial first line before redaction, including a credential split by retention.
    const tail = this.cut ? this.tail.slice(this.tail.indexOf('\n') + 1) : this.tail
    const output =
      this.cut && !this.tail.includes('\n')
        ? ''
        : redactReportText(stripVTControlCharacters(tail), this.secrets).trim()
    if (!output) {
      const safe = redactReportText(diagnosticMessage(error), this.secrets)
      return error instanceof Error && error.message === safe ? error : new Error(safe)
    }
    return new Error(
      `${redactReportText(diagnosticMessage(error), this.secrets)}\nMCP server stderr${this.cut || output.length > 2000 ? ' (tail)' : ''}:\n${output.slice(-2000)}`,
    )
  }
}
