use super::task_revisions::TaskOperation;

actions!(
    dovo,
    [NextMention, PreviousMention, AcceptMention, DismissMention]
);
pub(super) fn init(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("down", NextMention, Some("DovoComposerMentions > Input")),
        KeyBinding::new("up", PreviousMention, Some("DovoComposerMentions > Input")),
        KeyBinding::new("enter", AcceptMention, Some("DovoComposerMentions > Input")),
        KeyBinding::new("tab", AcceptMention, Some("DovoComposerMentions > Input")),
        KeyBinding::new(
            "escape",
            DismissMention,
            Some("DovoComposerMentions > Input"),
        ),
    ]);
}

use super::*;
use serde::Deserialize;

#[derive(Clone, Debug, PartialEq, Eq)]
struct Mention {
    trigger: char,
    start: usize,
    caret: usize,
    query: String,
}
fn js_space(c: char) -> bool {
    c == '\u{feff}' || c.is_whitespace() && c != '\u{85}'
}
fn mention(text: &str, caret: usize) -> Option<Mention> {
    let before = text.get(..caret)?;
    let token_start = before
        .char_indices()
        .rev()
        .find(|(_, c)| js_space(*c))
        .map_or(0, |(i, c)| i + c.len_utf8());
    let token = &before[token_start..];
    let trigger = token.chars().next()?;
    if matches!(trigger, '@' | '$' | '#') {
        let query = &token[1..];
        if trigger == '@' && !query.contains('@')
            || matches!(trigger, '$' | '#')
                && query
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'))
        {
            return Some(Mention {
                trigger,
                start: token_start,
                caret,
                query: query.into(),
            });
        }
    }
    let line_start = before.rfind('\n').map_or(0, |i| i + 1);
    let line = before[line_start..].trim_start_matches([' ', '\t']);
    let query = line.strip_prefix('/')?;
    query
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'))
        .then(|| Mention {
            trigger: '/',
            start: caret - query.len() - 1,
            caret,
            query: query.into(),
        })
}
#[derive(Clone, Deserialize)]
struct Resource {
    name: String,
    enabled: bool,
    description: Option<String>,
}
#[derive(Clone, Deserialize)]
struct Prompt {
    name: String,
    text: String,
}
#[derive(Clone)]
enum Suggestion {
    Text { label: String, insert: String },
    Command(&'static str),
}
impl Suggestion {
    fn label(&self) -> String {
        match self {
            Self::Text { label, .. } => label.clone(),
            Self::Command(id) => format!("/{id}"),
        }
    }
}
#[derive(Default)]
pub(super) struct MentionState {
    current: Option<(String, Mention)>,
    dismissed: Option<(String, Mention)>,
    files_key: Option<String>,
    files: Vec<String>,
    active: usize,
    error: Option<String>,
}
fn merged_named<T>(values: impl IntoIterator<Item = T>, name: impl Fn(&T) -> String) -> Vec<T> {
    let mut rows = Vec::<T>::new();
    for item in values {
        let key = name(&item);
        if let Some(index) = rows.iter().position(|row| name(row) == key) {
            rows[index] = item;
        } else {
            rows.push(item);
        }
    }
    rows
}
fn context_items(
    task: &Task,
    snapshot: &Snapshot,
) -> anyhow::Result<(Vec<Resource>, Vec<Resource>, Vec<Prompt>)> {
    let repo = snapshot
        .workspace
        .repositories
        .iter()
        .find(|r| r.id == task.repository_id)
        .ok_or_else(|| anyhow::anyhow!("Project is unavailable"))?;
    let scoped = task_defaults::scoped_values(snapshot, repo);
    let mut resources = scoped
        .iter()
        .filter_map(|v| v.get("resources"))
        .collect::<Vec<_>>();
    if let Some(value) = repo.extra.get("resources") {
        resources.push(value);
    }
    let base = match task.extra.get("harness") {
        Some(value) => Some(value.clone()),
        None => snapshot
            .workspace
            .agents
            .iter()
            .find(|a| a.id == task.agent_id)
            .map(serde_json::to_value)
            .transpose()?,
    };
    let agent_resources = task
        .extra
        .get("agentOverrides")
        .and_then(|v| v.get("resources"))
        .or_else(|| base.as_ref().and_then(|v| v.get("resources")));
    if let Some(value) = agent_resources {
        resources.push(value);
    }
    let read = |field: &str| -> anyhow::Result<Vec<Resource>> {
        let mut rows = Vec::new();
        for value in &resources {
            if let Some(list) = value.get(field) {
                rows.extend(serde_json::from_value::<Vec<Resource>>(list.clone())?);
            }
        }
        Ok(merged_named(rows, |r| r.name.clone()))
    };
    let mut prompts = Vec::new();
    for value in scoped
        .iter()
        .copied()
        .filter_map(|v| v.get("prompts"))
        .chain(repo.extra.get("prompts"))
    {
        prompts.extend(serde_json::from_value::<Vec<Prompt>>(value.clone())?);
    }
    Ok((
        read("skills")?,
        read("mcpServers")?,
        merged_named(prompts, |p| p.name.to_lowercase()),
    ))
}
impl Workbench {
    fn current_mention(&self, cx: &App) -> Option<(String, Mention)> {
        let id = self.selected_task.clone()?;
        let input = self.composer.read(cx);
        let range = input.selected_range();
        if !range.is_empty() {
            return None;
        }
        mention(&input.value(), range.end).map(|mention| (id, mention))
    }
    fn update_mentions(&mut self, cx: &mut Context<Self>) {
        let next = self.current_mention(cx);
        if next == self.mentions.current {
            return;
        }
        self.mentions.current = next.clone();
        self.mentions.files.clear();
        self.mentions.files_key = None;
        self.mentions.active = 0;
        self.mentions.error = None;
        if let Some((id, mention)) = next
            && mention.trigger == '@'
            && mention.query.encode_utf16().count() <= 200
            && self.online
        {
            let key = format!("mention-files:{}", uuid::Uuid::new_v4());
            self.mentions.files_key = Some(key.clone());
            let generation = self.generation;
            cx.spawn(async move |this, cx| {
                cx.background_executor()
                    .timer(std::time::Duration::from_millis(120))
                    .await;
                let _ = this.update(cx, |this, cx| {
                    if this.generation == generation
                        && this.mentions.files_key.as_ref() == Some(&key)
                        && this.current_mention(cx) == Some((id.clone(), mention.clone()))
                    {
                        this.request(
                            key,
                            "/api/tasks/files",
                            json!({"id":id,"query":mention.query}),
                        );
                    }
                });
            })
            .detach();
        }
    }
    pub(super) fn receive_mention_files(&mut self, key: &str, result: Result<Value, String>) {
        if self.mentions.files_key.as_deref() != Some(key) {
            return;
        }
        #[derive(Deserialize)]
        struct Files {
            files: Vec<String>,
        }
        match result.and_then(|v| serde_json::from_value::<Files>(v).map_err(|e| e.to_string())) {
            Ok(files) => self.mentions.files = files.files,
            Err(error) => self.mentions.error = Some(error),
        }
    }
    fn mention_suggestions(
        &self,
        task: &Task,
        current: &Mention,
    ) -> anyhow::Result<Vec<Suggestion>> {
        let snapshot = self
            .snapshot
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Runtime is unavailable"))?;
        let (skills, servers, prompts) = context_items(task, snapshot)?;
        let query = current.query.to_lowercase();
        let mut result = Vec::new();
        if current.trigger == '#' {
            let mut prompts = prompts
                .into_iter()
                .filter(|p| {
                    p.name.to_lowercase().contains(&query)
                        || query.len() > 2 && p.text.to_lowercase().contains(&query)
                })
                .collect::<Vec<_>>();
            prompts.sort_by_key(|p| (!p.name.to_lowercase().starts_with(&query), p.name.clone()));
            result.extend(prompts.into_iter().take(8).map(|p| Suggestion::Text {
                label: format!(
                    "#{} · {}",
                    p.name,
                    p.text.chars().take(80).collect::<String>()
                ),
                insert: p.text,
            }));
        } else {
            if current.trigger == '/' {
                for id in ["review", "compact", "new-session", "undo"] {
                    if id.starts_with(&query)
                        && self.online
                        && !task.is_archived()
                        && task.status != TaskStatus::Running
                        && (id == "review"
                            || self
                                .mention_operation(task, id)
                                .is_some_and(|op| op.available(task)))
                    {
                        result.push(Suggestion::Command(id));
                    }
                }
            }
            let items = if current.trigger == '@' {
                servers
                    .into_iter()
                    .filter(|s| s.enabled)
                    .collect::<Vec<_>>()
            } else {
                skills
            };
            let mut items = items
                .into_iter()
                .filter(|s| s.name.to_lowercase().contains(&query))
                .collect::<Vec<_>>();
            items.sort_by_key(|s| {
                (
                    !s.name.to_lowercase().starts_with(&query),
                    !s.enabled,
                    s.name.clone(),
                )
            });
            result.extend(items.into_iter().take(8).map(|s| Suggestion::Text {
                label: format!(
                    "{}{}{}{}",
                    current.trigger,
                    s.name,
                    if s.enabled {
                        ""
                    } else {
                        " · this message only"
                    },
                    s.description.map(|d| format!(" · {d}")).unwrap_or_default()
                ),
                insert: format!("{}{} ", current.trigger, s.name),
            }));
            if current.trigger == '@' {
                result.extend(self.mentions.files.iter().map(|path| Suggestion::Text {
                    label: format!("@{path}"),
                    insert: format!("@{path} "),
                }));
            }
        }
        Ok(result)
    }
    fn mention_operation(&self, task: &Task, id: &str) -> Option<TaskOperation> {
        match id {
            "compact" => Some(TaskOperation::Compact),
            "new-session" => Some(TaskOperation::NewSession),
            "undo" => task
                .turns
                .iter()
                .rev()
                .find(|turn| {
                    turn.checkpoint
                        .as_ref()
                        .is_some_and(|c| task_revisions::checkpoint_restorable(c, "undo"))
                })
                .map(|turn| TaskOperation::RestoreTurn(turn.id.clone(), "undo")),
            _ => None,
        }
    }
    fn choose_mention(
        &mut self,
        task: &Task,
        current: &Mention,
        item: Suggestion,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.current_mention(cx) != Some((task.id.clone(), current.clone())) {
            return;
        }
        if let Suggestion::Command(id) = &item {
            if !self.online
                || task.is_archived()
                || task.status == TaskStatus::Running
                || self
                    .pending_sends
                    .values()
                    .any(|(task_id, _)| task_id == &task.id)
            {
                return;
            }
            if *id != "review"
                && !self
                    .mention_operation(task, id)
                    .is_some_and(|op| op.available(task))
            {
                return;
            }
        }
        let text = match &item {
            Suggestion::Text { insert, .. } => insert.clone(),
            Suggestion::Command(_) => String::new(),
        };
        self.composer.update(cx, |input, cx| {
            input.set_selected_range(current.start..current.caret, cx);
            input.replace(text, window, cx);
            input.focus(window, cx);
        });
        self.mentions = MentionState::default();
        if let Suggestion::Command(id) = item {
            if id == "review" {
                let message_id = uuid::Uuid::new_v4().to_string();
                let key = format!("send:{}:{message_id}", task.id);
                let text = "Review the changes so far.";
                self.pending_sends
                    .insert(key.clone(), (task.id.clone(), text.into()));
                self.request(
                    key,
                    "/api/tasks/message",
                    json!({"id":task.id,"messageId":message_id,"text":text,"review":true}),
                );
            } else if let Some(operation) = self.mention_operation(task, id) {
                self.run_task_operation(task, operation, window, cx);
            }
        }
        cx.notify();
    }
    fn mention_action(&mut self, action: &str, window: &mut Window, cx: &mut Context<Self>) {
        let composing = self.composer.update(cx, |input, cx| {
            input.marked_text_range(window, cx).is_some()
        });
        let Some(task) = self
            .task()
            .cloned()
            .map(|task| self.task_with_history(&task))
        else {
            cx.propagate();
            return;
        };
        let Some((id, current)) = self.current_mention(cx) else {
            cx.propagate();
            return;
        };
        if composing || self.mentions.dismissed.as_ref() == Some(&(id, current.clone())) {
            cx.propagate();
            return;
        }
        let items = match self.mention_suggestions(&task, &current) {
            Ok(items) if !items.is_empty() => items,
            _ => {
                cx.propagate();
                return;
            }
        };
        match action {
            "up" => self.mentions.active = (self.mentions.active + items.len() - 1) % items.len(),
            "down" => self.mentions.active = (self.mentions.active + 1) % items.len(),
            "accept" => self.choose_mention(
                &task,
                &current,
                items[self.mentions.active.min(items.len() - 1)].clone(),
                window,
                cx,
            ),
            "dismiss" => self.mentions.dismissed = Some((task.id.clone(), current)),
            _ => return,
        }
        cx.notify();
    }
    pub(super) fn composer_editor(
        &mut self,
        task: &Task,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        self.update_mentions(cx);
        let mut root = div().key_context("DovoComposer").flex().flex_col().gap_2();
        if let Some((id, current)) = self.mentions.current.clone()
            && id == task.id
            && self.mentions.dismissed.as_ref() != Some(&(id, current.clone()))
            && self.composer.read(cx).focus_handle(cx).is_focused(window)
        {
            match self.mention_suggestions(task, &current) {
                Ok(items) => {
                    let mut menu = div()
                        .id("mention-suggestions")
                        .max_h(px(200.))
                        .overflow_y_scroll()
                        .flex()
                        .flex_col()
                        .gap_1()
                        .border_1()
                        .border_color(cx.theme().border);
                    for (index, item) in items.iter().cloned().enumerate() {
                        let task = task.clone();
                        let current = current.clone();
                        let label = item.label();
                        menu = menu.child(
                            Button::new(SharedString::from(format!("mention-{index}")))
                                .ghost()
                                .label(label)
                                .selected(self.mentions.active == index)
                                .on_click(cx.listener(move |this, _, window, cx| {
                                    this.choose_mention(&task, &current, item.clone(), window, cx)
                                })),
                        );
                    }
                    if let Some(error) = &self.mentions.error {
                        menu = menu.child(error.clone());
                    }
                    if !items.is_empty() || self.mentions.error.is_some() {
                        root = root.child(menu);
                    }
                    if !items.is_empty() {
                        root = root
                            .key_context("DovoComposer DovoComposerMentions")
                            .on_action(cx.listener(|this, _: &NextMention, window, cx| {
                                this.mention_action("down", window, cx)
                            }))
                            .on_action(cx.listener(|this, _: &PreviousMention, window, cx| {
                                this.mention_action("up", window, cx)
                            }))
                            .on_action(cx.listener(|this, _: &AcceptMention, window, cx| {
                                this.mention_action("accept", window, cx)
                            }))
                            .on_action(cx.listener(|this, _: &DismissMention, window, cx| {
                                this.mention_action("dismiss", window, cx)
                            }));
                    }
                }
                Err(error) => root = root.child(error.to_string()),
            }
        }
        root.child(
            Textarea::new(&self.composer)
                .appearance(false)
                .bordered(false),
        )
        .into_any_element()
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    #[test]
    fn triggers_and_ranges_preserve_unicode_and_reject_prose_paths() {
        let text = "🦀 inspect @src/a and keep suffix";
        let caret = text.find(" and").unwrap();
        let found = mention(text, caret).unwrap();
        assert_eq!(found.query, "src/a");
        assert_eq!(&text[found.start..caret], "@src/a");
        for text in [
            "email@host",
            "see /compact",
            "https://host",
            "$bad/name",
            "#bad/name",
        ] {
            assert!(mention(text, text.len()).is_none());
        }
        for text in [
            "\t/compact",
            "line\n  /compact",
            "$skill.name",
            "#saved-prompt",
            "\u{feff}@file",
        ] {
            assert!(mention(text, text.len()).is_some());
        }
    }
    #[test]
    fn suggestions_use_all_scopes_and_the_frozen_harness() {
        let snapshot:Snapshot=serde_json::from_value(json!({"revision":1,"workspace":{"version":1,"runtimeAddress":"","agents":[],"repositories":[{"id":"repo","name":"Project","path":"/tmp","branch":"main","gitIdentity":"forge/repo","resources":{"skills":[{"name":"same","description":"local","enabled":true}]},"prompts":[{"name":"CHECK","text":"Local prompt"}]}],"tasks":[],"automations":[]},"approvals":[],"questions":[],"terminals":[],"runs":[],"devices":[],"pendingDevices":[],"owner":true,"defaults":{"scopedSettings":{"shared":[{"key":"global","value":{"resources":{"skills":[{"name":"same","description":"global","enabled":true}]},"prompts":[{"name":"check","text":"Global prompt"}]}},{"key":"project:forge/repo","value":{"resources":{"mcpServers":[{"name":"source","enabled":true}]}}}],"environment":{"resources":{"skills":[{"name":"computer","description":"computer","enabled":true}]}}}}})).unwrap();
        let task:Task=serde_json::from_value(json!({"id":"task","repositoryId":"repo","agentId":"deleted-agent","title":"Draft","status":"draft","createdAt":"now","messages":[],"files":[],"draft":"","example":false,"harness":{"resources":{"skills":[{"name":"same","description":"frozen","enabled":false}]}}})).unwrap();
        let (skills, servers, prompts) = context_items(&task, &snapshot).unwrap();
        assert_eq!(skills.len(), 2);
        assert!(!skills.iter().find(|s| s.name == "same").unwrap().enabled);
        assert_eq!(servers[0].name, "source");
        assert_eq!(prompts.len(), 1);
        assert_eq!(prompts[0].text, "Local prompt");
    }
    #[test]
    fn resource_overrides_keep_disabled_skills_and_replace_servers_by_name() {
        let rows = merged_named(
            vec![
                Resource {
                    name: "a".into(),
                    enabled: true,
                    description: None,
                },
                Resource {
                    name: "a".into(),
                    enabled: false,
                    description: None,
                },
            ],
            |r| r.name.clone(),
        );
        assert_eq!(rows.len(), 1);
        assert!(!rows[0].enabled);
    }
}
