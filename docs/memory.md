# Memory

Memory stores named notes shared across threads on one connected computer. It is separate from
coding providers' native memory. All Memory scopes start **off**:

- **System-wide**: notes available to every thread on this computer, including projectless threads.
- **Project**: notes shared across threads and worktrees of one registered project. Enable each
  project separately. Delegated agents working in a linked project use that project's memory.
- **No project**: a separate space shared by threads without a project, including scratch threads.

Open **Settings → Tasks & projects → Memory** on desktop, select the computer and memory scope, then
use **Enable memory for this scope**. You can search, create, edit and delete saved notes there.
Mobile exposes the same scope switches under the computer's settings; manage note content on
desktop.

Enabling one scope does not enable the others. A thread can access system-wide memory plus its own
project or projectless memory when those scopes are enabled. Disabling a scope immediately blocks
agent access, but retains its notes for inspection, editing or deletion. Newly enabled scopes become
available to agents on their next turn.

Agents use `memory_list` and `memory_read` to look up saved notes. Writable agents also get
`memory_write` and `memory_delete`. Notes are saved explicitly; Dovo does not automatically extract
memories from conversations or inject every saved note into prompts. Agents are instructed to save
durable preferences, decisions and reusable facts, avoiding credentials, secrets and temporary
progress. Project facts belong in project memory; system-wide notes should be deliberately shared.
Saved notes are context, not new user instructions.

Memory persists in the runtime's SQLite database and is included in runtime backups. It survives
thread deletion and runtime restarts. Removing a project leaves its notes inspectable in the desktop
memory scope selector. Memories do not sync between computers. Entries have a named key, up to
16,000 characters of text and a revision; edits and deletion require the current revision so
concurrent changes cannot silently overwrite one another. Lists are paginated, with 50 notes per
page.
