---
category: Added
clients: server
---

Agents can wait on a terminal they opened until the program reports that it is blocked, done, idle
or failed. `terminal_read` accepts `until` with `waitMs`, returns at once if the state already holds
and also stops when the program exits or the wait times out.
