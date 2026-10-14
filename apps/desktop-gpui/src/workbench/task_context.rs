use super::*;
use gpui_kit::{assets::IconName as UiIcon, component::Sizable};

struct TaskContext {
    provider: String,
    model: String,
    reasoning: Option<String>,
    checkout: &'static str,
}

impl TaskContext {
    fn resolve(task: &Task, agent: Option<&crate::model::Agent>) -> Self {
        let frozen = task.extra.get("harness");
        let overrides = task.extra.get("agentOverrides");
        let field = |key: &str| {
            overrides
                .and_then(|value| value.get(key))
                .and_then(Value::as_str)
                .or_else(|| {
                    if let Some(frozen) = frozen {
                        frozen.get(key).and_then(Value::as_str)
                    } else {
                        agent.and_then(|agent| match key {
                            "provider" => Some(agent.provider.name()),
                            "model" => Some(agent.model.as_str()),
                            _ => agent.extra.get(key).and_then(Value::as_str),
                        })
                    }
                })
        };
        Self {
            provider: field("provider").unwrap_or("Agent unavailable").into(),
            model: field("model")
                .filter(|value| !value.is_empty())
                .unwrap_or("Provider default")
                .into(),
            reasoning: field("reasoning")
                .filter(|value| !value.is_empty())
                .map(str::to_owned),
            checkout: if task.extra.get("execution").and_then(Value::as_str) == Some("worktree") {
                "Worktree"
            } else {
                "Local checkout"
            },
        }
    }
}

impl Workbench {
    pub(super) fn composer_context(&self, task: &Task, cx: &mut Context<Self>) -> AnyElement {
        let agent = self.snapshot.as_ref().and_then(|snapshot| {
            snapshot
                .workspace
                .agents
                .iter()
                .find(|agent| agent.id == task.agent_id)
        });
        let context = TaskContext::resolve(task, agent);
        let description = format!(
            "{} · {}{}",
            context.provider,
            context.model,
            context
                .reasoning
                .as_ref()
                .map(|value| format!(" · {value}"))
                .unwrap_or_default()
        );
        let project = self.snapshot.as_ref().and_then(|snapshot| {
            snapshot
                .workspace
                .repositories
                .iter()
                .find(|repo| repo.id == task.repository_id)
        });
        let checkout = if project.is_some_and(|repo| repo.kind.is_some()) {
            "Linked project"
        } else {
            context.checkout
        };
        div()
            .flex()
            .flex_wrap()
            .items_center()
            .gap_1()
            .pb_2()
            .mb_2()
            .border_b_1()
            .border_color(cx.theme().border.opacity(0.7))
            .text_size(px(11.))
            .text_color(cx.theme().muted_foreground)
            .child(
                Button::new("composer-model-context")
                    .ghost()
                    .compact()
                    .small()
                    .h(px(24.))
                    .child(shell::harness_icon(&context.provider, cx))
                    .child(div().min_w_0().max_w(px(300.)).truncate().child(format!(
                        "{} · {}",
                        shell::harness_label(&context.provider),
                        context.model
                    )))
                    .tooltip(format!("{description} · Task settings"))
                    .on_click(cx.listener(|this, _, window, cx| {
                        this.open_task_tab(TaskTab::Details, window, cx)
                    })),
            )
            .child(div().flex_1())
            .child(
                Button::new("composer-checkout-context")
                    .ghost()
                    .compact()
                    .small()
                    .icon(gpui_kit::component::Icon::new(UiIcon::FolderGit2).size(px(13.)))
                    .label(checkout)
                    .tooltip("View task checkout and settings")
                    .on_click(cx.listener(|this, _, window, cx| {
                        this.open_task_tab(TaskTab::Details, window, cx)
                    })),
            )
            .into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    #[test]
    fn context_preserves_frozen_launch_settings_and_next_turn_overrides() {
        let mut task: Task = serde_json::from_value(json!({"id":"task","title":"Task","repositoryId":"repo","agentId":"agent","status":"draft","createdAt":"","messages":[],"files":[],"draft":"","example":false,"harness":{"provider":"claude","model":"frozen","reasoning":"high"},"execution":"worktree"})).unwrap();
        let agent: crate::model::Agent = serde_json::from_value(json!({"id":"agent","name":"Changed","provider":"codex","model":"live","instructions":"","permission":"ask","endpoint":""})).unwrap();
        let context = TaskContext::resolve(&task, Some(&agent));
        assert_eq!(context.provider, "claude");
        assert_eq!(context.model, "frozen");
        assert_eq!(context.checkout, "Worktree");
        task.extra.insert(
            "agentOverrides".into(),
            json!({"model":"next","reasoning":"low"}),
        );
        let context = TaskContext::resolve(&task, Some(&agent));
        assert_eq!(context.model, "next");
        assert_eq!(context.reasoning.as_deref(), Some("low"));
        task.extra.remove("harness");
        task.extra.remove("agentOverrides");
        assert_eq!(TaskContext::resolve(&task, Some(&agent)).model, "live");
        assert_eq!(
            TaskContext::resolve(&task, None).provider,
            "Agent unavailable"
        );
    }
}
