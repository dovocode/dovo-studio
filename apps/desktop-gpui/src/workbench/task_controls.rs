use super::*;

impl Workbench {
    pub(super) fn task_controls(
        &mut self,
        task: &Task,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let mutable = self.online && !task.is_archived();
        let mut root = div()
            .id("task-details")
            .flex()
            .flex_col()
            .flex_1()
            .overflow_y_scroll()
            .p_5()
            .gap_4()
            .child(Self::header(
                "Task details",
                "Execution history and scheduled follow-ups.",
            ));
        root = root.child(format!(
            "Project: {} · Agent: {}",
            task.repository_id, task.agent_id
        ));
        root = root.child(self.task_session_controls(task, cx));
        root = root.child(self.task_linked_checkouts(task, window, cx));
        if task.status == TaskStatus::Draft && task.turns.is_empty() {
            root = root.child(Self::header("Start after task", "Starts this draft after another task completes, using the request in your composer."));
            if let Some(source) = task
                .extra
                .get("startAfter")
                .and_then(|value| value.get("taskId"))
                .and_then(Value::as_str)
            {
                let title = self
                    .snapshot
                    .as_ref()
                    .and_then(|snapshot| {
                        snapshot
                            .workspace
                            .tasks
                            .iter()
                            .find(|item| item.id == source)
                    })
                    .map(|item| item.title.as_str())
                    .unwrap_or(source);
                root = root.child(format!("Waiting for: {title}"));
                let id = task.id.clone();
                root = root.child(
                    Button::new("remove-task-chain")
                        .label("Remove dependency")
                        .disabled(
                            !mutable || self.pending.contains(&format!("task-chain:{}", task.id)),
                        )
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.request(
                                format!("task-chain:{id}"),
                                "/api/tasks/start-after",
                                json!({"id":id,"sourceId":null}),
                            );
                            cx.notify();
                        })),
                );
            } else {
                let key = format!("chain-filter:{}", task.id);
                root = root.child(self.field(
                    &key,
                    "Find a task",
                    "",
                    "Search task titles",
                    window,
                    cx,
                ));
                let filter = self.value(&key, cx).to_lowercase();
                let sources: Vec<_> = self
                    .snapshot
                    .as_ref()
                    .map(|snapshot| {
                        snapshot
                            .workspace
                            .tasks
                            .iter()
                            .filter(|source| {
                                source.id != task.id
                                    && !source.is_archived()
                                    && source.title.to_lowercase().contains(&filter)
                            })
                            .map(|source| (source.id.clone(), source.title.clone(), source.status))
                            .collect()
                    })
                    .unwrap_or_default();
                let mut choices = div()
                    .id("chain-task-choices")
                    .h(px((sources.len() as f32 * 40.).min(220.)))
                    .flex_shrink_0()
                    .max_h(px(220.))
                    .overflow_y_scroll()
                    .flex()
                    .flex_col()
                    .gap_2();
                for (source, title, status) in sources {
                    let id = task.id.clone();
                    let before = task.draft.clone();
                    choices = choices.child(Button::new(SharedString::from(format!("chain-after-{source}"))).label(format!("After {title} · {status:?}")).disabled(!mutable || self.pending.contains(&format!("task-chain:{}", task.id))).on_click(cx.listener(move |this, _, _, cx| {
                        let draft = this.drafts.get(&id).cloned().unwrap_or_else(|| before.clone());
                        let has_message = this.snapshot.as_ref().and_then(|snapshot| snapshot.workspace.tasks.iter().find(|task| task.id == id)).is_some_and(|task| task.messages.iter().any(|message| message.role == Role::User && !message.text.trim().is_empty()));
                        if draft.trim().is_empty() && !has_message { this.error = Some("Write the next task’s request in the composer before chaining it".into()); }
                        else {
                            this.pending.insert(format!("task-chain:{id}")); this.error = None;
                            this.command(Command::ChainTask { generation: this.generation, id: id.clone(), source: source.clone(), before: before.clone(), draft });
                        }
                        cx.notify();
                    })));
                }
                root = root.child(choices);
            }
        }
        let budget = task.extra.get("budget").cloned().unwrap_or(Value::Null);
        let budget_prefix = format!("budget:{}", task.id);
        root=root.child(Self::header("Task budget","Stop at the configured token or time budget. Leave a value blank to remove that limit."));
        for (field, label) in [
            ("tokens", "Token budget"),
            ("minutes", "Time budget in minutes"),
        ] {
            let value = budget
                .get(field)
                .and_then(Value::as_u64)
                .map(|value| value.to_string())
                .unwrap_or_default();
            root = root.child(self.field(
                &format!("{budget_prefix}:{field}"),
                label,
                &value,
                "No limit",
                window,
                cx,
            ));
        }
        let budget_id = task.id.clone();
        root = root.child(
            Button::new("save-task-budget")
                .label("Save budget")
                .disabled(!mutable)
                .on_click(cx.listener(move |this, _, _, cx| {
                    let mut after = serde_json::Map::new();
                    for field in ["tokens", "minutes"] {
                        let text = this.value(&format!("{budget_prefix}:{field}"), cx);
                        if text.trim().is_empty() {
                            continue;
                        }
                        match text.trim().parse::<u64>() {
                            Ok(value) if value > 0 && value <= 9_007_199_254_740_991 => {
                                after.insert(field.into(), json!(value));
                            }
                            _ => {
                                this.error =
                                    Some("Budget limits must be positive whole numbers".into());
                                cx.notify();
                                return;
                            }
                        }
                    }
                    let after = if after.is_empty() {
                        Value::Null
                    } else {
                        Value::Object(after)
                    };
                    this.patch(
                        format!("budget:{budget_id}"),
                        WorkspacePatch::update(
                            "tasks",
                            budget_id.clone(),
                            "budget",
                            budget.clone(),
                            after,
                        ),
                    );
                    cx.notify();
                })),
        );
        let overrides = task
            .extra
            .get("agentOverrides")
            .cloned()
            .unwrap_or(Value::Null);
        let model_prefix = format!("task-model:{}", task.id);
        root = root.child(Self::header(
            "Model overrides",
            "Applies to this task's next turn. Blank values inherit the saved agent configuration.",
        ));
        for (field, label) in [
            ("model", "Model ID"),
            ("reasoning", "Reasoning effort"),
            ("serviceTier", "Service tier"),
        ] {
            root = root.child(
                self.field(
                    &format!("{model_prefix}:{field}"),
                    label,
                    overrides
                        .get(field)
                        .and_then(Value::as_str)
                        .unwrap_or_default(),
                    "Inherit agent",
                    window,
                    cx,
                ),
            );
        }
        let model_id = task.id.clone();
        root = root.child(
            Button::new("save-task-model")
                .label("Save model overrides")
                .disabled(!mutable || task.status == TaskStatus::Running)
                .on_click(cx.listener(move |this, _, _, cx| {
                    let mut after = overrides.as_object().cloned().unwrap_or_default();
                    for field in ["model", "reasoning", "serviceTier"] {
                        let value = this.value(&format!("{model_prefix}:{field}"), cx);
                        if value.trim().is_empty() {
                            after.remove(field);
                        } else {
                            after.insert(field.into(), json!(value.trim()));
                        }
                    }
                    let after = if after.is_empty() {
                        Value::Null
                    } else {
                        Value::Object(after)
                    };
                    this.patch(
                        format!("task-model:{model_id}"),
                        WorkspacePatch::update(
                            "tasks",
                            model_id.clone(),
                            "agentOverrides",
                            overrides.clone(),
                            after,
                        ),
                    );
                    cx.notify();
                })),
        );
        if let Some(context) = task.extra.get("contextUsage") {
            let used = context.get("used").and_then(Value::as_u64);
            let limit = context.get("limit").and_then(Value::as_u64);
            if let (Some(used), Some(limit)) = (used, limit) {
                root = root.child(format!("Context: {used} / {limit} tokens"));
            }
        }
        root = root.child(Self::header("Scheduled follow-ups", "Enter a future date and time with its UTC offset (for example 2026-10-20T09:00:00+01:00)."));
        for followup in &task.scheduled_messages {
            let task_id = task.id.clone();
            let id = followup.id.clone();
            let mut item = div()
                .p_3()
                .border_1()
                .border_color(cx.theme().border)
                .rounded_md()
                .flex()
                .flex_col()
                .gap_2()
                .child(followup.at.clone())
                .child(followup.text.clone());
            if let Some(error) = &followup.failed {
                item = item.child(format!("Failed: {error}"));
            }
            root = root.child(
                item.child(
                    Button::new(SharedString::from(format!("cancel-schedule-{id}")))
                        .ghost()
                        .label("Cancel follow-up")
                        .disabled(!mutable)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.request(
                                format!("schedule-remove:{id}"),
                                "/api/tasks/schedule",
                                json!({"id":task_id,"removeId":id}),
                            );
                            cx.notify();
                        })),
                ),
            );
        }
        let at_key = format!("schedule-at:{}", task.id);
        let text_key = format!("schedule-text:{}", task.id);
        root = root
            .child(self.field(
                &at_key,
                "Date and time",
                "",
                "YYYY-MM-DDTHH:MM:SS+00:00",
                window,
                cx,
            ))
            .child(self.text_field(
                &text_key,
                "Follow-up message",
                "",
                "What should the agent do?",
                window,
                cx,
            ));
        let task_id = task.id.clone();
        root = root.child(
            Button::new("schedule-followup")
                .label("Schedule follow-up")
                .disabled(!mutable || self.pending.contains(&format!("schedule-add:{}", task.id)))
                .on_click(cx.listener(move |this, _, _, cx| {
                    let text = this.text_value(&text_key, cx);
                    let time = this.value(&at_key, cx);
                    match chrono::DateTime::parse_from_rfc3339(time.trim()) {
                        Ok(time) if time > chrono::Utc::now() && !text.trim().is_empty() => {
                            this.request(
                                format!("schedule-add:{task_id}"),
                                "/api/tasks/schedule",
                                json!({"id":task_id,"text":text,"at":time.to_rfc3339()}),
                            );
                        }
                        _ => {
                            this.error = Some(
                                "Enter a follow-up message and a future date with a UTC offset"
                                    .into(),
                            )
                        }
                    }
                    cx.notify();
                })),
        );
        root = root.child(self.save_task_template(task, window, cx));
        root = root.child(Self::header("Turns", "Inspect saved file changes or fork a separate draft. Retry runs the latest turn again."));
        root = root.child(self.earlier_history_button(task, cx));
        let task_with_history = self.task_with_history(task);
        for turn in task_with_history.turns.iter().rev() {
            let id = turn.id.clone();
            let mut card = div()
                .p_3()
                .border_1()
                .border_color(cx.theme().border)
                .rounded_md()
                .flex()
                .flex_col()
                .gap_2()
                .child(format!(
                    "{} · {} · {} · {}",
                    turn.started_at,
                    turn.provider.name(),
                    turn.model,
                    turn.status
                ));
            if let Some(tokens) = turn.tokens {
                card = card.child(format!("Tokens: {tokens}"));
            }
            if let Some(cost) = turn.estimated_cost_usd {
                card = card.child(format!("Estimated API cost: ${cost:.4}"));
            }
            if let Some(error) = &turn.error {
                card = card.child(error.clone());
            }
            let task_id = task.id.clone();
            let fork_id = id.clone();
            let actions = div().flex().gap_2().child(
                Button::new(SharedString::from(format!("fork-{id}")))
                    .label("Fork from turn")
                    .disabled(!mutable || turn.status == "running")
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.request(
                            format!("fork-turn:{fork_id}"),
                            "/api/tasks/fork",
                            json!({"id":task_id,"turnId":fork_id}),
                        );
                        cx.notify();
                    })),
            );
            card = card.child(actions.child(self.task_operation_button(
                &task_with_history,
                task_revisions::TaskOperation::Retry(id),
                cx,
            )));
            card = card.child(self.turn_checkpoint(&task_with_history, turn, window, cx));
            root = root.child(card);
        }
        root.into_any_element()
    }

    pub(super) fn side_chats(
        &mut self,
        task: &Task,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let mutable = self.online && !task.is_archived();
        let mut root = div()
            .id("side-chats")
            .flex()
            .flex_col()
            .flex_1()
            .overflow_y_scroll()
            .p_5()
            .gap_4()
            .child(Self::header(
                "Side chats",
                "Ask about this task while keeping a separate conversation.",
            ));
        let task_id = task.id.clone();
        root = root.child(
            Button::new("create-side-chat")
                .label("New side chat")
                .disabled(!mutable || self.pending.contains(&format!("side-create:{}", task.id)))
                .on_click(cx.listener(move |this, _, _, cx| {
                    this.request(
                        format!("side-create:{task_id}"),
                        "/api/tasks/side-chat/save",
                        json!({"id":task_id}),
                    );
                    cx.notify();
                })),
        );
        for chat in &task.side_chats {
            let prefix = format!("side:{}:{}", task.id, chat.id);
            let mut card = div()
                .p_4()
                .border_1()
                .border_color(cx.theme().border)
                .rounded_md()
                .flex()
                .flex_col()
                .gap_3()
                .child(self.field(
                    &format!("{prefix}:title"),
                    "Title",
                    &chat.title,
                    "Side chat title",
                    window,
                    cx,
                ));
            for message in &chat.messages {
                card = card.child(
                    TextView::markdown(
                        SharedString::from(format!("side-question-{}", message.id)),
                        message.question.clone(),
                    )
                    .selectable(true),
                );
                if let Some(answer) = &message.answer {
                    card = card.child(
                        TextView::markdown(
                            SharedString::from(format!("side-answer-{}", message.id)),
                            answer.clone(),
                        )
                        .selectable(true),
                    );
                }
                if let Some(error) = &message.error {
                    card = card.child(format!("Failed: {error}"));
                }
                if message.status == "pending" {
                    card = card.child("Waiting for an answer…");
                }
            }
            card = card.child(self.text_field(
                &format!("{prefix}:draft"),
                "Question",
                &chat.draft,
                "Ask about the task",
                window,
                cx,
            ));
            let task_id = task.id.clone();
            let chat_id = chat.id.clone();
            let save_prefix = prefix.clone();
            let mut actions = div().flex().gap_2().child(Button::new(SharedString::from(format!("save-{prefix}"))).label("Save title & draft")
                .disabled(!mutable || chat.messages.iter().any(|message| message.status == "pending")).on_click(cx.listener(move |this, _, _, cx| {
                    this.request(format!("side-save:{chat_id}"),"/api/tasks/side-chat/save",json!({"id":task_id,"chatId":chat_id,"title":this.value(&format!("{save_prefix}:title"),cx),"draft":this.text_value(&format!("{save_prefix}:draft"),cx)})); cx.notify();
                })));
            let task_id = task.id.clone();
            let chat_id = chat.id.clone();
            actions = actions.child(
                Button::new(SharedString::from(format!("ask-{prefix}")))
                    .primary()
                    .label("Ask")
                    .disabled(
                        !mutable
                            || chat
                                .messages
                                .iter()
                                .any(|message| message.status == "pending")
                            || self.pending.contains(&format!("side-ask:{chat_id}")),
                    )
                    .on_click(cx.listener(move |this, _, _, cx| {
                        let question = this.text_value(&format!("{prefix}:draft"), cx);
                        if question.trim().is_empty() {
                            this.error = Some("Enter a side question".into());
                        } else {
                            this.pending_text_submissions.insert(
                                format!("side-ask:{chat_id}"),
                                (format!("{prefix}:draft"), question.clone()),
                            );
                            this.request(
                                format!("side-ask:{chat_id}"),
                                "/api/tasks/side-chat/ask",
                                json!({"id":task_id,"chatId":chat_id,"question":question}),
                            );
                        }
                        cx.notify();
                    })),
            );
            root = root.child(card.child(actions));
        }
        root.into_any_element()
    }
}
