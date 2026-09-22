# Codex speed and Daybreak

Dovo discovers model choices, per-model reasoning levels, descriptions, and service tiers from the
selected runtime's authenticated `codex app-server`. Refresh models after upgrading Codex or
changing its login. The **Provider default** model uses the catalog's default model capabilities
too.

On desktop, open **Reasoning and speed** beside the model to find **Service Tier** and the
**Daybreak** submenu. Access has its own picker. Mobile, custom agent and task settings expose the
same options under model settings:

- **Speed → Standard** uses `serviceTier: "default"`. This explicitly clears Fast on a resumed
  thread and its next turn.
- **Speed → Fast** uses the exact service tier ID advertised by the installed harness, with its own
  description. In Codex 0.155.1 the advertised ID is `priority`; the CLI configuration name is
  `fast`. Dovo does not substitute one for the other or hardcode a speed/price multiplier. The run's
  configuration enables `features.fast_mode` without modifying your global `config.toml`. Managed
  restrictions still apply.
- **Daybreak → Automatic** omits the per-turn override and lets Codex choose its normal treatment.
- **Daybreak → Off** explicitly sends `cyberAccessProgram: "standard"`.
- **Daybreak Blue / Red** sends `cyberAccessProgram: "daybreakBlue"` / `"daybreakRed"` on
  `turn/start`. Only programs represented in the authenticated model catalog are offered, with a
  ChatGPT login and a compatible harness. A saved but unavailable choice remains visible instead of
  silently switching models.

Daybreak is a separate control from model selection, speed, reasoning, and permissions. Codex owns
authorization and model-tier restrictions. Choosing a mode does not grant access. The Daybreak model
aliases also remain selectable in the ordinary model picker, including with API-key authentication
when that model is available.

For persistent chats, Dovo also saves `daybreakEnabled` through `thread/metadata/update`. That
metadata alone does **not** activate Daybreak: Dovo supplies the requested treatment for every turn.
These experimental fields were verified against the generated protocol from Codex **0.155.1**;
explicit mode overrides fail with an upgrade message on older or unidentified harnesses, rather than
risking a silently ignored field.

Selecting Daybreak does not change your permission choice. OpenAI recommends automatic approval
review with an enforceable sandbox for authorized cybersecurity work; Dovo's **Auto** setting uses
Codex's reviewer. It remains separate from **Auto-accept edits** and **Full access**. Host and
organization requirements remain authoritative.

Titles and light dictation cleanup retain their existing separate model/reasoning settings and
read-only, text-only execution. They do not inherit a custom agent's per-turn Daybreak override.

## Specification references

- [Codex App Server: model discovery and version-matched generated bindings](https://learn.chatgpt.com/docs/app-server)
- [Codex speed and Fast mode](https://learn.chatgpt.com/docs/agent-configuration/speed)
- [Model availability and managed Fast mode requirements](https://learn.chatgpt.com/docs/enterprise/workspace-model-availability)
- [Daybreak models and Trusted Access](https://learn.chatgpt.com/docs/cyber-safety)
- [Recommended cybersecurity configuration and automatic review](https://learn.chatgpt.com/docs/cyber-safety/recommended-configuration)
- [Daybreak Blue model alias](https://developers.openai.com/api/docs/models/gpt-daybreak-blue-latest)
- [Daybreak Red model alias](https://developers.openai.com/api/docs/models/gpt-daybreak-red-latest)
