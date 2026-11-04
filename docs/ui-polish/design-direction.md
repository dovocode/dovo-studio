# Design direction: Quiet Instrument

Opus reviewed frozen production-component screenshots and matching source, without past or target
scores. Dominic asked for implementation-ready direction addressing a busy, bloated and inconsistent
workspace, with particular attention to Settings.

The direction is a graphite workspace with one quiet navigation signal. Keep the near-black canvas,
thin activity rail, rounded outlined sidebars and flat main chat/Browser. Preserve every section,
grouping and workflow control. Thread info remains an overlay that clears the composer.

## Implementation priorities

1. **Use one navigation grammar.** Selected navigation, thread, Browser, Agent and open-file rows
   share a quiet fill and a small 2px × 16px location marker. Thin icon rails retain the marker
   without another filled tile. Filters use a neutral selected fill. Focus remains distinct; custom
   accent, gradient, glow and high-contrast preferences still apply.
2. **Make Settings context persistent.** Scoped pages pin the actual project/computer target while
   scrolling. Label defaults and overrides accurately. Keep automatic saves, separately saved
   groups, explicit Save/Discard boundaries, capability notices and draft-navigation guards.
3. **Use the available width.** Standard setting rows have a 240px control column when content is at
   least 720px wide; narrower content stacks. Agent profiles use a flat master/detail layout from
   960px of content, otherwise a searchable profile picker and full-width form. The actual form
   width determines label/control layout. Dirty actions identify the edited profile and target.
4. **Reduce competing framing and type choices.** Runtime computers and settings become flatter
   sections. Computer rows emphasize Manage, with secondary/recovery/destructive actions in More.
   Shared page, section, row, metadata and machine-fact type tokens retain user text scaling. Thread
   rows keep their three-line anatomy and required icons, with tighter spacing.
5. **Verify composition and behavior together.** Inspect populated, dirty, scrolled, narrow and
   legacy Settings states in both themes. Verify keyboard selection, sticky context, save failures,
   scope changes and draft protection. Check dense thread/PR/issue lists, Browser and file
   selection, forced colors and all palette/mode combinations before freezing screenshots for a new
   review.

The consultation also proposed a universal list-row component and broader workflow changes. Those
are not prerequisites for this pass: existing save semantics, merge readiness and Git staging
boundaries remain authoritative. Changes should simplify presentation without inventing behavior.

The [generated composition reference](../../output/imagegen/README.md) informed layout only. Actual
screenshots and verification limits are documented in [the gallery](README.md).
