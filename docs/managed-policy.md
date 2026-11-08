# Managed runtime policy

An administrator can install an optional JSON policy on each runtime. Without a policy, Dovo keeps
its existing behavior. Policies never require an account or HTTPS: paired devices and device tokens
remain required, and HTTP connections over LAN, Tailscale and NetBird remain supported.

The policy is loaded at startup, including by the desktop updater. Restart the runtime and desktop
after changing it. An invalid installed policy prevents startup instead of silently ignoring
controls. This is host configuration, not a replacement for OS process isolation: administrators
must protect the policy, runtime installation, launcher environment and provider configuration from
modification by users they intend to restrict. A user who controls those files or the runtime
process can bypass them.

## Install and validate

Default paths:

- Linux: `/etc/dovo-studio/policy.json`
- macOS: `/Library/Application Support/DovoStudio/policy.json`
- Windows: `%ProgramFiles%/DovoStudio/policy.json`

Use administrator-owned directories and restrict write permissions. `DOVO_POLICY_PATH` selects an
explicit alternative file for deployment/testing; a missing explicit file is an error. The JSON file
must be a regular file smaller than 256 KiB. Native MDM profiles and Windows registry policy are not
read directly; deployment tools can provision this JSON file.

Validate a candidate before deploying:

```sh
dovo-server policy check /path/to/policy.json --json
dovo-server policy show --json
# From source:
pnpm server policy check /path/to/policy.json --json
```

`show` reads the installed file for this process, not the running server. Runtime diagnostics and
mobile Settings show the running runtime's policy summary and fingerprint. Restart after deployment
and compare fingerprints. Diagnostic summaries omit provider environment values and update-feed
URLs. Do not put credentials in this file; use the host's existing credential mechanisms.

## Example

```json
{
  "schemaVersion": 1,
  "organization": "Example team",
  "supportUrl": "http://help.internal/dovo",
  "settings": {
    "allowWebRequests": { "value": false, "locked": true }
  },
  "limits": {
    "providers": {
      "allowed": ["codex", "claude"],
      "instances": {
        "codex": {
          "locked": true,
          "executablePath": "/opt/managed/bin/codex"
        }
      }
    },
    "maxPermission": "workspace-write",
    "sharing": false,
    "connect": false,
    "webhookTasks": false,
    "browserCookieImport": false,
    "clients": ["desktop", "local-browser", "remote"],
    "updates": { "mode": "auto", "allowNightly": false }
  }
}
```

## Supported controls

Every section except `schemaVersion` and `organization` is optional. Unknown fields are rejected.

- `settings`: runtime preference dot paths, each with `value` and `locked`. Values are checked
  against Dovo's runtime preference schema. A locked value overrides user preferences; an unlocked
  value is a default only when no user value exists. Parent and child paths cannot overlap. Managed
  values are not copied into user settings; removing policy restores the underlying user preference.
- `limits.providers.allowed`: nonempty list of supported provider IDs. Disallowed providers cannot
  be probed, listed for models or run. Existing thread history is retained.
- `limits.providers.instances`: provider IDs mapped to `locked` plus optional `executablePath`,
  `configDirectory`, `args`, and `env`. Locked fields override user launcher configuration; unlocked
  fields supply defaults. Summaries list locked field names without their values.
- `limits.maxPermission`: maximum Dovo access preset. Effective custom approval/sandbox controls are
  checked as well. Threads above the ceiling must lower access before continuing. A ceiling also
  replaces user launcher overrides with provider defaults or administrator configuration, preventing
  a user-supplied wrapper, flags or environment from disabling provider controls. Arbitrary ACP
  launchers are unavailable under a ceiling. Provider-specific sandbox limitations still apply.
- `limits.sharing`: disables thread/artifact sharing when false, including saved publication
  workers.
- `limits.connect`: disables Dovo Connect internet access when false. LAN/VPN pairing is separate.
- `limits.webhookTasks`: disables webhook-triggered tasks when false.
- `limits.browserCookieImport`: records the restriction when false. Dovo currently has no external
  browser cookie import operation; its managed browser profiles retain their existing behavior.
- `limits.clients`: nonempty list from `desktop`, `local-browser`, `remote`. Remote admission uses
  actual socket/tunnel provenance. Local browser admission uses browser origin information; it is
  not a security boundary against a local user controlling their client or process.
- `limits.telemetry`: accepts only `false`; Dovo has no policy-enabled telemetry service.
- `limits.updates`: `mode` is `auto` or `off`. `off` disables Dovo's update operations, including
  manual in-app checks/downloads. `auto` retains the normal check/download/restart flow; it does not
  force unattended installation. `allowNightly: false` restricts updates to stable releases.
  `feedUrl` optionally selects a generic Electron desktop update feed, using HTTP or HTTPS. Server
  distribution updates still use their existing package/source mechanism.

Controls are checked by the runtime as well as surfaced to clients. Existing user settings remain
editable where a particular control has no dedicated disabled UI; conflicting operations return a
managed-policy error naming the organization. Policies do not delete threads, projects or
credentials.
