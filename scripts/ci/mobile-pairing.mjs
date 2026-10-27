import { createServer } from 'node:http'

// Maestro starts its host-side driver before entering the pairing form. Request
// the real code only when typing it, so startup never consumes its lifetime.
export function preparePairingFlow(flow) {
  return flow
    .replaceAll(
      '- inputText: ${RUNTIME_ADDRESS}',
      // Maestro 2.11's iOS TextInputHelper sends multi-character input at 30 Hz.
      // URL-keyboard startup can drop the middle of that synthesized burst. Each
      // single-character command uses the driver's slower path; never retry or
      // silently repair an incorrect field value after the assertion.
      [
        '- evalScript: ${output.addressCharacter = 0}',
        '- repeat:',
        '    times: ${RUNTIME_ADDRESS.length}',
        '    commands:',
        '      - inputText: ${RUNTIME_ADDRESS.charAt(output.addressCharacter)}',
        '      - evalScript: ${output.addressCharacter++}',
        '- assertVisible:',
        '    id: Computer address',
        '    text: ${RUNTIME_ADDRESS}',
      ].join('\n'),
    )
    .replaceAll(
      '- inputText: ${PAIRING_CODE}',
      "- evalScript: ${output.pairing = json(http.post(PAIRING_CONTROL_ADDRESS + '/pairing-code', {body:'{}'}).body)}\n- inputText: ${output.pairing.code}\n- assertVisible:\n    id: Pairing code\n    text: ${output.pairing.code}",
    )
}

// Fixture-only loopback control; production pairing and its expiry stay intact.
export async function startPairingControl(pairing) {
  const server = createServer((request, response) => {
    if (request.method !== 'POST' || request.url !== '/pairing-code') {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    })
    response.end(JSON.stringify(pairing.createCode()))
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return {
    address: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      server.closeAllConnections()
      await new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      )
    },
  }
}
