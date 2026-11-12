# Secure input

Use the `dovo_task.secure_input` tool for passwords and confidential auth callback URLs. Do not ask
for these values in chat or `ask_question`.

The tool opens a masked form in the desktop or mobile thread. The form shows the destination,
command arguments and working folder. The user must select **Submit and run privately** or **Submit
callback privately**. Studio UI tools cannot submit the desktop form. Notifications only ask the
user to open Studio. They do not offer an inline reply.

## Tool use

Request a local command that reads its secret from stdin:

```json
{
  "action": "request",
  "key": "registry-sign-in",
  "title": "Registry sign-in",
  "prompt": "Enter the registry password.",
  "destination": {
    "kind": "command",
    "command": "/absolute/path/to/trusted-login",
    "args": ["--password-stdin"],
    "appendNewline": true
  }
}
```

Studio uses the thread's checkout as the working folder. It starts the executable directly. It does
not interpolate a shell command. The value goes to stdin, never to process arguments or environment
variables. Standard output and standard error go to the operating system's null device. They do not
enter terminal buffers, command history, logs or tool results. On Windows, select an executable that
can start without a shell; batch scripts are not supported.

For an ACP browser sign-in that is already waiting, use:

```json
{
  "action": "request",
  "key": "agent-browser-sign-in",
  "title": "Complete agent sign-in",
  "prompt": "Paste the callback URL from your browser.",
  "destination": { "kind": "auth_callback", "installationId": "installed-agent-id" }
}
```

Studio binds the request to that sign-in job. It accepts only an HTTP loopback callback whose port
and path match the advertised redirect. It checks OAuth state when the sign-in supplies one. It
requires a code, rejects URL credentials, and does not follow redirects. A replacement sign-in needs
a new secure-input request. This destination supports pending ACP browser sign-ins, not arbitrary
URLs.

After a valid callback is submitted, Studio stops retaining sign-in diagnostic output and replaces
consumer errors with a fixed message. This prevents a CLI's callback echo from entering diagnostics.

Request returns an ID and `pending` status. Reuse identical arguments and the same key after an
uncertain request. The key belongs to that agent turn. A status message arrives in the thread after
completion, failure, cancellation or expiry. It contains only the ID and status. To check or cancel
a known request, use:

```json
{ "action": "status", "id": "secure-input:returned-id" }
```

```json
{ "action": "cancel", "id": "secure-input:returned-id" }
```

A pending form is not consent to run the command. Restricted and read-only agent runs cannot request
secure input. Paired human device credentials remain required to submit it. Agent run credentials
cannot submit values.

## Private data boundary

The form encrypts the value before it calls the runtime client. Each request has a fresh in-memory
Curve25519 key. NaCl authenticated encryption binds the value to the request and thread. Transport
adapters receive only an encrypted envelope. Pairing and normal runtime routing still apply,
including HTTP over LAN, VPN, Tailscale and NetBird. This does not require an account or HTTPS.

The value is never put in Studio's model input, ordinary question responses, snapshots, saved
drafts, recovery journals, activity rows, analytics or tool responses. No plaintext draft is saved.
Forms clear input on background, unmount, connection replacement and submission. Mobile submission
reads the native end-editing text and rejects late events from a cleared field. After an uncertain
response, the form can retry the same encrypted envelope. The runtime invokes its consumer once for
that request and device. It keeps only a ciphertext fingerprint for replay checks.

Requests expire after ten minutes. Command delivery has a sixty-second limit. Input supports up to
8192 UTF-8 bytes and preserves whitespace. Cancelling or stopping the owning turn aborts delivery.
Runtime shutdown drains active consumers before closing storage. Restart removes all pending
requests and keys; enter a new value for a new request. In-memory status receipts are bounded to 128
requests.

Stop also cancels pending requests from earlier turns. Tightening the thread's access cancels its
requests. A late submission response cannot undo a cancelled form.

The paired runtime and the selected executable are trusted destinations. Review the full command
before submitting. A program can store or send what it reads, even when Studio discards its output.
Do not select a command that writes secrets into files or services the agent can read. Studio cannot
protect against a compromised runtime, an untrusted executable, OS memory inspection or a device's
third-party input software. JavaScript strings cannot be reliably erased from memory; Studio clears
references and wipes the byte buffers and request keys it owns.

Encryption protects the submitted value from passive capture and keeps it out of request bodies in
plaintext. Runtime public keys use the existing paired transport. It does not add an independent
identity pin against an active attacker who controls an HTTP connection. Use a trusted LAN/VPN path
or HTTPS when that threat applies. HTTP support remains available.

## Verification

Use synthetic values for checks. Never put a real secret in a test, fixture, screenshot or command
argument.

```sh
pnpm --filter @dovo/protocol --filter @dovo/runtime -r build
pnpm exec playwright install chromium
pnpm test:secure-input:browser
pnpm exec vp test packages/runtime/src/agent-tools/secure-input.test.ts packages/runtime/src/agent-tools/secure-command.test.ts packages/runtime/src/agent-tools/interactions.test.ts packages/runtime/src/http/endpoints/acp-routes.test.ts packages/runtime/src/agent-tools/context-budget.test.ts packages/runtime/src/http/runtime-sync.test.ts packages/runtime/src/agents/execution/questions.test.ts packages/studio-shell/src/task-notifications.test.ts --maxWorkers=2
pnpm --filter @dovo/mobile --filter @dovo/extension-tasks --filter @dovo/studio-shell --filter @dovo/runtime -r typecheck
pnpm check
```

The browser check uses real encryption and desktop React components. Its mobile controls adapt React
Native to Chromium. Runtime tests exercise the real MCP/HTTP/stdin boundary, SQLite, process
cancellation and an HTTP OAuth callback listener. These checks do not establish native iOS/Android
keyboard, app-switcher or accessibility behavior on physical hardware.
