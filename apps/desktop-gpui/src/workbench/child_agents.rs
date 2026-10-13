use super::*;
use crate::model::{NativeThreadEntry, NativeThreadPage, Subagent, TodoStatus};

pub(super) struct ThreadDraft {
    owner: String,
    agent: Subagent,
    pub(super) key: String,
    older: bool,
    entries: Vec<NativeThreadEntry>,
    before: Option<String>,
    notice: Option<String>,
}
impl Workbench {
    pub(super) fn receive_native_thread(&mut self, key: &str, value: &Value) {
        let Some(thread) = self
            .native_thread
            .as_mut()
            .filter(|thread| thread.key == key)
        else {
            return;
        };
        match serde_json::from_value::<NativeThreadPage>(value.clone()) {
            Ok(mut page) => {
                if thread.older {
                    let ids: HashSet<_> =
                        page.entries.iter().map(|entry| entry.id.clone()).collect();
                    page.entries.extend(
                        thread
                            .entries
                            .iter()
                            .filter(|entry| !ids.contains(&entry.id))
                            .cloned(),
                    );
                }
                thread.entries = page.entries;
                thread.before = page.before;
                thread.notice = page.notice;
            }
            Err(error) => self.error = Some(format!("Invalid child transcript: {error}")),
        }
    }
    fn load_native_thread(&mut self, older: bool) {
        let Some(thread) = &mut self.native_thread else {
            return;
        };
        if self.pending.contains(&thread.key) {
            return;
        }
        let mut input =
            json!({"taskId":thread.owner,"id":thread.agent.id,"provider":thread.agent.provider});
        if let Some(session) = &thread.agent.session_id {
            input["sessionId"] = json!(session);
        }
        if older && let Some(before) = &thread.before {
            input["before"] = json!(before);
        }
        thread.older = older;
        thread.key = format!("native-thread:{}", uuid::Uuid::new_v4());
        let key = thread.key.clone();
        self.request(key, "/api/tasks/native-thread", input);
    }
    pub(super) fn native_todos(&self, task: &Task, cx: &Context<Self>) -> AnyElement {
        let todos = task.native_todos.as_deref().unwrap_or_default();
        if todos.is_empty() {
            return div().into_any_element();
        }
        div()
            .id("native-todos")
            .max_h(px(150.))
            .overflow_y_scroll()
            .p_3()
            .border_t_1()
            .border_color(cx.theme().border)
            .child(
                div()
                    .text_xs()
                    .font_weight(FontWeight::SEMIBOLD)
                    .child(format!(
                        "Provider plan · {}/{} completed",
                        todos
                            .iter()
                            .filter(|todo| todo.status == TodoStatus::Completed)
                            .count(),
                        todos.len()
                    )),
            )
            .children(todos.iter().enumerate().map(|(index, todo)| {
                div().text_sm().py_1().child(
                    TextView::markdown(
                        SharedString::from(format!("todo-{}-{index}", task.id)),
                        format!(
                            "{} {}",
                            match todo.status {
                                TodoStatus::Completed => "✓",
                                TodoStatus::InProgress => "→",
                                TodoStatus::Pending => "○",
                            },
                            todo.text
                        ),
                    )
                    .selectable(true),
                )
            }))
            .into_any_element()
    }
    pub(super) fn child_agents_page(
        &mut self,
        task: &Task,
        _window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let mut root = div()
            .id("child-agents")
            .flex_1()
            .min_h_0()
            .overflow_y_scroll()
            .p_4()
            .flex()
            .flex_col()
            .gap_3();
        if let Some(thread) = &self.native_thread {
            let busy = self.pending.contains(&thread.key);
            root = root
                .child(
                    div()
                        .flex()
                        .flex_wrap()
                        .gap_2()
                        .child(
                            Button::new("child-thread-back")
                                .label("Back to agents")
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.native_thread = None;
                                    cx.notify();
                                })),
                        )
                        .child(
                            Button::new("child-thread-refresh")
                                .label("Refresh thread")
                                .disabled(!self.online || busy)
                                .on_click(cx.listener(|this, _, _, cx| {
                                    this.load_native_thread(false);
                                    cx.notify();
                                })),
                        ),
                )
                .child(format!(
                    "{} · {} · Read only",
                    thread.agent.name, thread.agent.provider
                ));
            if let Some(notice) = &thread.notice {
                root = root.child(notice.clone());
            }
            if busy {
                root = root.child("Loading thread…");
            }
            if thread.before.is_some() {
                root = root.child(
                    Button::new("child-thread-older")
                        .label("Load older messages")
                        .disabled(!self.online || busy)
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.load_native_thread(true);
                            cx.notify();
                        })),
                );
            }
            if thread.entries.is_empty() && !busy {
                root = root.child("No conversation messages are available.");
            }
            for entry in &thread.entries {
                root = root.child(
                    div()
                        .border_1()
                        .border_color(cx.theme().border)
                        .rounded_md()
                        .p_3()
                        .child(entry.label.as_deref().unwrap_or(&entry.role).to_owned())
                        .child(
                            TextView::markdown(
                                SharedString::from(format!("child-entry-{}", entry.id)),
                                entry.text.clone(),
                            )
                            .selectable(true),
                        ),
                );
            }
            return root.into_any_element();
        }
        if let Some(parent) = &task.delegation {
            let parent = parent.parent_task_id.clone();
            root = root.child(
                Button::new("parent-task")
                    .label("Back to parent thread")
                    .on_click(cx.listener(move |this, _, window, cx| {
                        this.select_task(parent.clone(), window, cx)
                    })),
            );
        }
        let hide = self.hide_finished_agents;
        root = root.child(
            Button::new("hide-finished-agents")
                .label(if hide {
                    "Show finished agents"
                } else {
                    "Hide finished agents"
                })
                .on_click(cx.listener(|this, _, _, cx| {
                    this.hide_finished_agents = !this.hide_finished_agents;
                    cx.notify();
                })),
        );
        let agents: Vec<_> = self
            .snapshot
            .as_ref()
            .map(|snapshot| {
                crate::task_family::agents(&snapshot.workspace.tasks, &task.id)
                    .into_iter()
                    .map(|(owner, agent)| (owner.clone(), agent.clone()))
                    .collect()
            })
            .unwrap_or_default();
        let token_result = self
            .snapshot
            .as_ref()
            .map(|snapshot| crate::task_family::run_token(&snapshot.workspace.tasks, &task.id));
        let token = token_result
            .as_ref()
            .and_then(|result| result.as_ref().ok())
            .cloned();
        let working = agents.iter().any(|(_, agent)| {
            agent.native_working()
                || (agent.source.as_deref() == Some("dovo")
                    && agent.finished_at.is_none()
                    && agent.status == "working")
        });
        if working {
            if let Some(Err(error)) = &token_result {
                root = root.child(error.to_string());
            }
            let root_id = task.id.clone();
            root = root.child(
                Button::new("stop-family-agents")
                    .label("Stop agents")
                    .disabled(
                        !self.online
                            || token.is_none()
                            || self.pending.contains(&format!("stop-agents:{root_id}")),
                    )
                    .on_click(cx.listener(move |this, _, _, cx| {
                        if let Some(token) = &token {
                            this.request(
                                format!("stop-agents:{root_id}"),
                                "/api/tasks/stop-agents",
                                json!({"id":root_id,"runToken":token}),
                            );
                            cx.notify();
                        }
                    })),
            );
        }
        if agents.is_empty() {
            root =
                root.child("No subagents yet. Agents spawned by a supported harness appear here.");
        }
        for (index, (owner, agent)) in agents.into_iter().enumerate() {
            if hide
                && (agent.finished_at.is_some()
                    || !matches!(agent.status.as_str(), "working" | "unknown"))
            {
                continue;
            }
            let mut card = div()
                .p_3()
                .border_1()
                .border_color(cx.theme().border)
                .rounded_md()
                .child(format!(
                    "{} · {} · {}",
                    agent.name,
                    agent.provider,
                    if agent.status == "working"
                        && !agent.native_working()
                        && agent.source.as_deref() != Some("dovo")
                    {
                        "Last seen working"
                    } else {
                        &agent.status
                    }
                ))
                .child(format!(
                    "{}{}{}",
                    agent.model.as_deref().unwrap_or(""),
                    agent
                        .reasoning
                        .as_ref()
                        .map(|value| format!(" · {value}"))
                        .unwrap_or_default(),
                    agent
                        .tokens
                        .map(|value| format!(" · {value:.0} tokens"))
                        .unwrap_or_default()
                ));
            for (label, text) in [
                ("Prompt", &agent.prompt),
                ("Result", &agent.result),
                ("Activity", &agent.activity),
            ] {
                if let Some(text) = text {
                    card = card.child(
                        TextView::markdown(
                            SharedString::from(format!("child-{index}-{label}")),
                            format!("**{label}**\n\n{text}"),
                        )
                        .selectable(true),
                    );
                }
            }
            let mut actions = div().flex().flex_wrap().gap_2();
            if agent.source.as_deref() == Some("dovo") {
                let child = agent.task_id.clone().unwrap_or(agent.id.clone());
                let target = self
                    .snapshot
                    .as_ref()
                    .and_then(|s| s.workspace.tasks.iter().find(|task| task.id == child))
                    .cloned();
                let open = child.clone();
                actions = actions.child(
                    Button::new(SharedString::from(format!("child-open-{index}")))
                        .label("Open child thread")
                        .on_click(cx.listener(move |this, _, window, cx| {
                            this.select_task(open.clone(), window, cx)
                        })),
                );
                if let Some(run) = target.and_then(|task| task.active_run_id) {
                    actions = actions.child(
                        Button::new(SharedString::from(format!("child-stop-{index}")))
                            .label("Stop child")
                            .disabled(
                                !self.online
                                    || self.pending.contains(&format!("child-stop:{child}")),
                            )
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.request(
                                    format!("child-stop:{child}"),
                                    "/api/tasks/cancel",
                                    json!({"id":child,"runId":run}),
                                );
                                cx.notify();
                            })),
                    );
                }
            } else {
                let open = agent.clone();
                let owner_id = owner.id.clone();
                actions = actions.child(
                    Button::new(SharedString::from(format!("child-view-{index}")))
                        .label("View native thread")
                        .disabled(!self.online)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.native_thread = Some(ThreadDraft {
                                owner: owner_id.clone(),
                                agent: open.clone(),
                                key: String::new(),
                                older: false,
                                entries: vec![],
                                before: None,
                                notice: None,
                            });
                            this.load_native_thread(false);
                            cx.notify();
                        })),
                );
                if agent.native_working() {
                    let token = self.snapshot.as_ref().and_then(|s| {
                        crate::task_family::run_token(&s.workspace.tasks, &owner.id).ok()
                    });
                    let owner = owner.id;
                    let child = agent.id;
                    actions = actions.child(
                        Button::new(SharedString::from(format!("child-stop-{index}")))
                            .label("Stop child")
                            .disabled(
                                !self.online
                                    || token.is_none()
                                    || self
                                        .pending
                                        .contains(&format!("child-stop:{owner}:{child}")),
                            )
                            .on_click(cx.listener(move |this, _, _, cx| {
                                if let Some(token) = &token {
                                    this.request(
                                        format!("child-stop:{owner}:{child}"),
                                        "/api/tasks/stop-agents",
                                        json!({"id":owner,"runToken":token,"childId":child}),
                                    );
                                    cx.notify();
                                }
                            })),
                    );
                }
            }
            root = root.child(card.child(actions));
        }
        root.into_any_element()
    }
}
