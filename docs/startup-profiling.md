# Startup profiling

Set `DOVO_STARTUP_PROFILE=1` in the environment when starting the server or desktop to print startup
milestones to stderr. The desktop passes the setting to a runtime it starts; that child's stderr is
captured in `runtime-service.log` in the desktop runtime data directory. An already running runtime
cannot be profiled retroactively; stop it and start a fresh process for a cold-start measurement.

Each line identifies the process component and milestone, the elapsed time since that component's
previous milestone, and total time since that process started. The first total includes module
loading; its phase delta starts when profiling is initialized. Desktop window loading and runtime
startup overlap, so desktop milestone deltas follow completion order and should not be treated as
independent sequential phases. Server and runtime milestones share a process but have separate phase
clocks. These timings do not include time spent before the process starts or renderer application
readiness. No paths, credentials, or conversation contents are printed.

For useful comparisons, use the same launch mode, database, machine and environment, and collect
several fresh-process runs. OS filesystem caches and existing background services affect results.
Leave the variable unset for normal use.
