---
category: Fixed
clients: server
---

Terminals from different runtimes share one recovery hook per provider config. Removing one runtime
keeps Codex, Claude, Pi and OpenCode recovery working for other runtimes.
