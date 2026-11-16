---
category: Fixed
clients: desktop, web, mobile
---

Fix sandbox startup failures with mise's aube npm installer. Hermes and Vibe install with Python
3.13 to use supported dependency builds. Stop finds child processes as the harness user, so commands
in a new process group stop without extra container capabilities.
