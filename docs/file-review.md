# Reviewing changed files

Task diffs and PR changes on desktop and mobile share viewed progress through the connected
computer. Mark a file viewed from the diff toolbar. Its check clears when that file's diff changes;
unchanged files keep their checks. Image and binary task files also reset when their saved content
or mode changes. PR files without a text patch reset conservatively when the PR revision changes.

Use **Related changes** to review dependencies before their callers, including linked tests,
re-exports and deleted imports. A shared dependency graph reads ASTs of both file versions for
JavaScript/TypeScript, Python, Go, Rust, Java, Kotlin, Swift, C# and PHP. Each language resolves its
own imports, package declarations and type references to changed files. Swift and Go also connect
types within the same module or package. Cycles use deterministic order. Ambiguous module roots,
unresolved aliases or external crates, unsupported syntax and unavailable source use a labeled
folder fallback. **Folders** switches back to path order. This is bounded static analysis, not a
compiler or build-system dependency graph.

PHP links namespace imports (including grouped imports and aliases), class, interface, trait and
enum references, and literal file includes anchored to `__DIR__` or `dirname(__FILE__)`. Class names
resolve case-insensitively against declarations in changed files, without guessing Composer paths.
Multiple namespace blocks, ambiguous declarations, function/constant imports and dynamic or
working-directory-dependent includes retain the folder fallback.

Go imports use the nearest `go.mod` module path. Standard-library and external imports cannot match
local files by basename. PR and historical module metadata comes from the same immutable Git
revisions as the code. Nested modules and build-system aliases without a known mapping retain the
folder fallback. Reading optional review metadata never creates a task checkout or runs its setup.

On mobile, tap the file path to open a searchable file browser. Both clients offer an **Unviewed
only** filter and previous, next and next-unviewed navigation. File and checkout navigation pause
while a task diff has an active edit. Mobile edits retain their text and disk baseline when
switching task panes. Cancel remains available if a refresh removes the file or replaces its text
with a preview. Desktop inline PR drafts retain their original revision and range across pushes;
stale drafts cannot post against the new revision.

Progress survives reopening a viewer and restarting the host. Task working-tree flags use workspace
synchronization with persisted monotonic file versions, so toggling a flag twice or removing and
readding a file cannot revive a stale write. PR, branch, linked-checkout and historical flags
refresh while the viewer is active, at most every 20 seconds, and immediately when it returns to the
foreground. Failed saves show an error and a retry control. A stale client cannot mark a newer file
revision as viewed.

PR dependency analysis uses complete sources from local Git objects when the matching commits are
available. Reads and AST caches are bounded; analysis does not fetch commits or modify the checkout.
Complete added/deleted file patches can also provide source. Incomplete patch fragments retain the
folder fallback. Missing local sources are retried after 20 seconds while the viewer is active, so
fetching the matching commits restores dependency grouping without a runtime restart. Stable
complete sources reuse cached analysis. The server loads WebAssembly grammars lazily and frees each
parse tree; only the requested grammars ship with the runtime, and mobile clients do no parsing.
