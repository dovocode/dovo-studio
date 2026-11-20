---
category: Fixed
clients: server
---

Startup cleanup keeps the attachments, sandbox container and private sandbox files of a thread that
the runtime saved but could not read, including threads that old releases saved. A new sandbox waits
for startup cleanup, and runtime shutdown waits for it to finish.
