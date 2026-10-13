use super::*;
use serde::Deserialize;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(super) enum WorkSource {
    Repository(String),
    Jira(String),
}
impl std::fmt::Display for WorkSource {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Repository(id) => f.write_str(id),
            Self::Jira(id) => write!(f, "jira:{id}"),
        }
    }
}
impl WorkSource {
    pub(super) fn input(&self) -> Value {
        match self {
            Self::Repository(id) => json!({"repositoryId": id}),
            Self::Jira(id) => json!({"jiraSourceId": id}),
        }
    }
}

#[derive(Clone, Default)]
pub(super) struct WorkList {
    query: Value,
    page: Option<Value>,
    request: Option<(String, bool)>,
    sequence: u64,
}
impl WorkList {
    pub(super) fn is_current(&self, key: &str) -> bool {
        self.request
            .as_ref()
            .is_some_and(|(current, _)| current == key)
    }
    fn begin(&mut self, scope: &str, query: Value, more: bool) -> String {
        self.sequence += 1;
        if self.query != query {
            self.page = None;
        }
        self.query = query;
        let key = format!("work-list:{scope}:{}", self.sequence);
        self.request = Some((key.clone(), more));
        key
    }
    fn receive(&mut self, key: &str, value: &Value) -> bool {
        let Some((current, more)) = &self.request else {
            return false;
        };
        if current != key {
            return false;
        }
        self.page = Some(if *more {
            append_page(
                self.page.as_ref(),
                value,
                if value.get("pulls").is_some() {
                    "pulls"
                } else {
                    "items"
                },
            )
        } else {
            value.clone()
        });
        self.request = None;
        true
    }
}

pub(super) fn append_page(previous: Option<&Value>, incoming: &Value, field: &str) -> Value {
    let Some(previous) = previous else {
        return incoming.clone();
    };
    let mut result = incoming.clone();
    let mut rows = previous
        .get(field)
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    for row in incoming
        .get(field)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        if let Some(index) = rows.iter().position(|old| {
            old.get("id").or_else(|| old.get("number")).is_some()
                && old.get("id").or_else(|| old.get("number"))
                    == row.get("id").or_else(|| row.get("number"))
        }) {
            rows[index] = row.clone();
        } else {
            rows.push(row.clone());
        }
    }
    result[field] = json!(rows);
    result["stale"] = json!(
        previous
            .get("stale")
            .and_then(Value::as_bool)
            .unwrap_or(false)
            || incoming
                .get("stale")
                .and_then(Value::as_bool)
                .unwrap_or(false)
    );
    if let Some(error) = previous.get("refreshError").filter(|v| v.is_string()) {
        result["refreshError"] = error.clone();
    }
    if let Some(old) = previous.get("cachedAt").and_then(Value::as_str) {
        let latest = incoming.get("cachedAt").and_then(Value::as_str);
        result["cachedAt"] = json!(latest.map_or(old, |latest| old.min(latest)));
    }
    result
}

#[derive(Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkOptions {
    #[serde(default)]
    issues: bool,
    #[serde(default)]
    pipelines: bool,
    issue_notice: Option<String>,
    pipeline_notice: Option<String>,
    #[serde(default)]
    issue_types: Vec<String>,
    #[serde(default)]
    issue_states: Vec<String>,
    #[serde(default)]
    issue_search: bool,
    #[serde(default)]
    assignees: bool,
    #[serde(default)]
    labels: bool,
    #[serde(default)]
    pipeline_actions: Vec<String>,
}

fn split_names(value: &str, maximum: usize, length: usize) -> anyhow::Result<Vec<String>> {
    let names: Vec<_> = value
        .split(',')
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_owned)
        .collect();
    anyhow::ensure!(names.len() <= maximum, "Use at most {maximum} entries");
    anyhow::ensure!(
        names
            .iter()
            .all(|name| name.encode_utf16().count() <= length),
        "Each entry must be at most {length} characters"
    );
    Ok(names)
}
pub(super) fn pipeline_inputs(text: &str) -> anyhow::Result<BTreeMap<String, String>> {
    let inputs: BTreeMap<String, String> = serde_json::from_str(text)?;
    anyhow::ensure!(inputs.len() <= 100, "Use at most 100 pipeline inputs");
    anyhow::ensure!(
        inputs.iter().all(|(key, value)| !key.is_empty()
            && key.encode_utf16().count() <= 100
            && value.encode_utf16().count() <= 10_000),
        "Invalid pipeline input name or value length"
    );
    Ok(inputs)
}

impl Workbench {
    pub(super) fn work_scope(page: Page, source: &WorkSource) -> String {
        format!("{}:{source}", page.label())
    }
    fn work_options(&self, page: Page, source: &WorkSource) -> WorkOptions {
        self.responses
            .get(&format!("work-options:{source}:{}", page.label()))
            .cloned()
            .and_then(|v| serde_json::from_value(v).ok())
            .unwrap_or_default()
    }
    pub(super) fn select_work_source(&mut self, page: Page, source: WorkSource) {
        if let WorkSource::Repository(id) = &source {
            self.selected_repository = Some(id.clone());
            self.read_task_agents();
        }
        self.work_source = Some(source.clone());
        let scope = Self::work_scope(page, &source);
        if !self.work_lists.contains_key(&scope) {
            self.load_work_list(page, &source, json!({"state":"open"}), false, false);
        }
        if page == Page::Pulls {
            self.request(
                format!("pull-options:{source}"),
                "/api/scm/pulls/options/read",
                source.input(),
            );
            return;
        }
        let mut input = source.input();
        input["area"] = json!(if page == Page::Issues {
            "issues"
        } else {
            "pipelines"
        });
        self.request(
            format!("work-options:{source}:{}", page.label()),
            "/api/scm/work/options",
            input,
        );
    }
    pub(super) fn load_work_list(
        &mut self,
        page: Page,
        source: &WorkSource,
        query: Value,
        more: bool,
        refresh: bool,
    ) {
        let scope = Self::work_scope(page, source);
        let state = self.work_lists.entry(scope.clone()).or_default();
        if more && state.request.is_some() {
            return;
        }
        let cursor = if more {
            if page == Page::Pulls {
                state
                    .page
                    .as_ref()
                    .filter(|v| v.get("hasMore").and_then(Value::as_bool) == Some(true))
                    .and_then(|v| v.get("page").and_then(Value::as_u64))
                    .map(|page| json!(page + 1))
            } else {
                state.page.as_ref().and_then(|v| v.get("next")).cloned()
            }
        } else {
            None
        };
        if more && cursor.is_none() {
            return;
        }
        let key = state.begin(&scope, query.clone(), more);
        let mut input = source.input();
        if let Some(fields) = query.as_object() {
            for (field, value) in fields {
                input[field] = value.clone();
            }
        }
        if let Some(cursor) = cursor {
            input[if page == Page::Pulls {
                "page"
            } else {
                "cursor"
            }] = cursor;
        }
        input["refresh"] = json!(refresh);
        self.request(
            key,
            match page {
                Page::Issues => "/api/scm/work/issues/list",
                Page::Pulls => "/api/scm/pulls/overview",
                _ => "/api/scm/work/pipelines/list",
            },
            input,
        );
    }
    pub(super) fn fail_work_request(&mut self, key: &str) {
        for list in self.work_lists.values_mut() {
            if list
                .request
                .as_ref()
                .is_some_and(|(current, _)| current == key)
            {
                list.request = None;
            }
        }
    }
    pub(super) fn receive_work_response(&mut self, key: &str, value: &Value, cx: &App) {
        if let Some(base) = key.strip_prefix("work-detail-more:") {
            let before = self.responses.remove(&format!("work-detail-before:{base}"));
            if before.as_ref() == self.responses.get(base) && before.is_some() {
                let field = if base.starts_with("work-detail:issues:") {
                    "comments"
                } else {
                    "jobs"
                };
                self.responses
                    .insert(base.to_owned(), append_page(before.as_ref(), value, field));
            }
        }
        if key.starts_with("work-definition-action:")
            && let Some((page, source)) = self.work_form.clone()
            && key.starts_with(&format!(
                "work-definition-action:{}:",
                Self::work_scope(page, &source)
            ))
        {
            self.notice = value
                .get("message")
                .and_then(Value::as_str)
                .map(str::to_owned);
            self.request(
                format!("work-definitions:{}", Self::work_scope(page, &source)),
                "/api/scm/work/pipelines/definitions",
                source.input(),
            );
        }
        if key.starts_with("work-list:") {
            for list in self.work_lists.values_mut() {
                list.receive(key, value);
            }
        }
        if let Some(scope) = key.strip_prefix("work-definitions-more:") {
            let base = format!("work-definitions:{scope}");
            let merged = append_page(self.responses.get(&base), value, "items");
            self.responses.insert(base, merged);
        }
        if let Some(scope) = key.strip_prefix("work-form-submit:") {
            self.notice = value
                .get("message")
                .and_then(Value::as_str)
                .map(str::to_owned);
            if let Some((page, source, sent)) = self.work_form_submissions.remove(key) {
                let unchanged = sent == self.form_fields(&format!("work-form:{scope}"), cx);
                if unchanged {
                    self.inputs
                        .retain(|key, _| !key.starts_with(&format!("work-form:{scope}:")));
                    self.textareas
                        .retain(|key, _| !key.starts_with(&format!("work-form:{scope}:")));
                    if self.work_form.as_ref() == Some(&(page, source.clone())) {
                        self.work_form = None;
                    }
                }
                let query = self
                    .work_lists
                    .get(scope)
                    .map(|list| list.query.clone())
                    .unwrap_or(json!({"state":"open"}));
                self.load_work_list(page, &source, query, false, true);
            }
        }
    }
    pub(super) fn work_list_page(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let page = self.page;
        let repositories = self
            .snapshot
            .as_ref()
            .map(|s| s.workspace.repositories.clone())
            .unwrap_or_default();
        let jira = self
            .snapshot
            .as_ref()
            .and_then(|s| s.workspace.extra.get("jiraSources"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let mut root = div()
            .id("work-list-page")
            .flex()
            .flex_col()
            .flex_1()
            .overflow_y_scroll()
            .p_6()
            .gap_4()
            .child(Self::header(
                page.label(),
                "Source control uses the connected computer's provider accounts.",
            ));
        let mut sources = div().flex().flex_wrap().gap_2();
        for repo in repositories.into_iter().filter(|repo| repo.kind.is_none()) {
            let source = WorkSource::Repository(repo.id);
            sources = sources.child(
                Button::new(SharedString::from(format!("work-source:{source}")))
                    .label(repo.name)
                    .selected(self.work_source.as_ref() == Some(&source))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.select_work_source(page, source.clone());
                        cx.notify();
                    })),
            );
        }
        if page == Page::Issues {
            for source in jira {
                let Some(id) = source.get("id").and_then(Value::as_str) else {
                    continue;
                };
                let label = source
                    .get("name")
                    .or_else(|| source.get("project"))
                    .and_then(Value::as_str)
                    .unwrap_or("Jira")
                    .to_owned();
                let source = WorkSource::Jira(id.to_owned());
                sources = sources.child(
                    Button::new(SharedString::from(format!("work-source:{source}")))
                        .label(format!("Jira · {label}"))
                        .selected(self.work_source.as_ref() == Some(&source))
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.select_work_source(page, source.clone());
                            cx.notify();
                        })),
                );
            }
        }
        root = root.child(sources);
        let Some(source) = self
            .work_source
            .clone()
            .filter(|s| page == Page::Issues || matches!(s, WorkSource::Repository(_)))
        else {
            return root.child("Choose a source.").into_any_element();
        };
        let scope = Self::work_scope(page, &source);
        let options = self.work_options(page, &source);
        let list = self.work_lists.get(&scope).cloned().unwrap_or_default();
        let mut toolbar = div().flex().flex_wrap().gap_2();
        let refresh_source = source.clone();
        let query = list.query.clone();
        toolbar = toolbar.child(
            Button::new("work-list-refresh")
                .label("Refresh")
                .disabled(!self.online || list.request.is_some())
                .on_click(cx.listener(move |this, _, _, cx| {
                    this.load_work_list(page, &refresh_source, query.clone(), false, true);
                    cx.notify();
                })),
        );
        let allowed = if page == Page::Pulls {
            self.responses
                .contains_key(&format!("pull-options:{source}"))
        } else if page == Page::Issues {
            options.issues
        } else {
            options.pipelines && options.pipeline_actions.iter().any(|v| v == "run")
        };
        let form_source = source.clone();
        toolbar = toolbar.child(
            Button::new("work-form-open")
                .primary()
                .label(if page == Page::Pulls {
                    "New pull request"
                } else if page == Page::Issues {
                    "New issue"
                } else {
                    "Run pipeline"
                })
                .disabled(!self.online || !allowed)
                .on_click(cx.listener(move |this, _, _, cx| {
                    this.work_form = Some((page, form_source.clone()));
                    if page == Page::Pipelines {
                        this.request(
                            format!("work-definitions:{}", Self::work_scope(page, &form_source)),
                            "/api/scm/work/pipelines/definitions",
                            form_source.input(),
                        );
                    }
                    cx.notify();
                })),
        );
        root = root.child(toolbar);
        let notice = if page == Page::Issues {
            options.issue_notice.clone()
        } else {
            options.pipeline_notice.clone()
        };
        root = root.children(notice);
        if matches!(page, Page::Issues | Page::Pulls) {
            root = root.child(
                self.field(
                    &format!("work-filter:{scope}:state"),
                    "State",
                    list.query
                        .get("state")
                        .and_then(Value::as_str)
                        .unwrap_or("open"),
                    "open, closed, all, or provider state",
                    window,
                    cx,
                ),
            );
            if options.issue_search {
                root = root.child(self.field(
                    &format!("work-filter:{scope}:query"),
                    "Search",
                    "",
                    "Search issues",
                    window,
                    cx,
                ));
            }
            if matches!(source, WorkSource::Jira(_)) {
                for (key, label, hint) in [
                    ("assignee", "Assignee", "all, mine, unassigned"),
                    ("priority", "Priority", "High"),
                    ("type", "Type", "Bug"),
                    ("label", "Label", "Label"),
                    (
                        "statusCategory",
                        "Status category",
                        "todo, in-progress, done",
                    ),
                ] {
                    root = root.child(self.field(
                        &format!("work-filter:{scope}:{key}"),
                        label,
                        "",
                        hint,
                        window,
                        cx,
                    ));
                }
            }
            let filter_source = source.clone();
            let filter_scope = scope.clone();
            root = root.child(
                Button::new("work-apply-filter")
                    .label("Apply filters")
                    .disabled(!self.online)
                    .on_click(cx.listener(move |this, _, _, cx| {
                        let state = this.value(&format!("work-filter:{filter_scope}:state"), cx);
                        let mut query =
                            json!({"state":if state.trim().is_empty() {"all"} else {state.trim()}});
                        if options.issue_search {
                            let search =
                                this.value(&format!("work-filter:{filter_scope}:query"), cx);
                            if !search.trim().is_empty() {
                                query["query"] = json!(search.trim());
                            }
                        }
                        if matches!(filter_source, WorkSource::Jira(_)) {
                            let mut filters = json!({});
                            for key in ["assignee", "priority", "type", "label", "statusCategory"] {
                                let value =
                                    this.value(&format!("work-filter:{filter_scope}:{key}"), cx);
                                if !value.trim().is_empty() {
                                    filters[key] = json!(value.trim());
                                }
                            }
                            query["jiraFilters"] = filters;
                        }
                        this.load_work_list(page, &filter_source, query, false, false);
                        cx.notify();
                    })),
            );
        }
        if self.work_form.as_ref() == Some(&(page, source.clone())) {
            root = root.child(self.work_create_form(page, &source, window, cx));
        }
        if let Some(value) = list.page {
            if value.get("stale").and_then(Value::as_bool) == Some(true) {
                root = root.child("Cached results may be out of date.");
            }
            root = root.children(
                value
                    .get("refreshError")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
            );
            let entries = value
                .get(if page == Page::Pulls {
                    "pulls"
                } else {
                    "items"
                })
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            if entries.is_empty() {
                root = root.child("No results.");
            }
            for item in entries {
                let Some(id) = item
                    .get("id")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
                    .or_else(|| {
                        item.get("number")
                            .and_then(Value::as_u64)
                            .map(|number| number.to_string())
                    })
                else {
                    continue;
                };
                let title = item
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or("Item")
                    .to_owned();
                let state = item
                    .get("state")
                    .or_else(|| item.get("status"))
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                let detail_source = source.clone();
                let stack = item
                    .get("stack")
                    .map(|stack| {
                        if stack.get("complete").and_then(Value::as_bool) == Some(true) {
                            match (
                                stack.get("position").and_then(Value::as_u64),
                                stack.get("size").and_then(Value::as_u64),
                            ) {
                                (Some(position), Some(size)) => {
                                    format!(" · Stack {position}/{size}")
                                }
                                _ => " · Stack · partial".into(),
                            }
                        } else {
                            " · Stack · partial".into()
                        }
                    })
                    .unwrap_or_default();
                root = root.child(
                    Button::new(SharedString::from(format!("work-item:{id}")))
                        .label(format!("{id} · {title} · {state}{stack}"))
                        .on_click(cx.listener(move |this, _, _, cx| {
                            if page == Page::Pulls {
                                if let WorkSource::Repository(repository) = &detail_source
                                    && let Ok(number) = id.parse::<u64>()
                                {
                                    this.selected_repository = Some(repository.clone());
                                    this.selected_pull = Some(number);
                                    this.request(
                                        format!("pull-detail:{repository}:{number}"),
                                        "/api/scm/pulls/detail",
                                        json!({"repositoryId":repository,"number":number}),
                                    );
                                }
                                cx.notify();
                                return;
                            }
                            let area = if page == Page::Issues {
                                "issues"
                            } else {
                                "pipelines"
                            };
                            this.selected_work = Some((page, detail_source.clone(), id.clone()));
                            let mut input = detail_source.input();
                            input["id"] = json!(id);
                            this.request(
                                format!("work-detail:{area}:{detail_source}:{id}"),
                                &format!("/api/scm/work/{area}/detail"),
                                input,
                            );
                            cx.notify();
                        })),
                );
            }
            if value.get("next").is_some_and(Value::is_string)
                || value.get("hasMore").and_then(Value::as_bool) == Some(true)
            {
                let more_source = source;
                let query = list.query;
                root = root.child(
                    Button::new("work-load-more")
                        .label("Load more")
                        .disabled(!self.online || list.request.is_some())
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.load_work_list(page, &more_source, query.clone(), true, false);
                            cx.notify();
                        })),
                );
            }
        } else {
            root = root.child(if list.request.is_some() {
                "Loading…"
            } else {
                "Refresh to load results."
            });
        }
        root.into_any_element()
    }

    fn work_create_form(
        &mut self,
        page: Page,
        source: &WorkSource,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        if page == Page::Pulls {
            return self.pull_create_form(source, window, cx);
        }
        let scope = Self::work_scope(page, source);
        let prefix = format!("work-form:{scope}");
        let options = self.work_options(page, source);
        let mut form = div()
            .p_4()
            .border_1()
            .border_color(cx.theme().border)
            .rounded_md()
            .flex()
            .flex_col()
            .gap_3();
        if page == Page::Issues {
            form = form
                .child(Self::header(
                    "New issue",
                    "Creates an issue in the selected source.",
                ))
                .child(self.field(
                    &format!("{prefix}:title"),
                    "Title",
                    "",
                    "Issue title",
                    window,
                    cx,
                ))
                .child(self.text_field(
                    &format!("{prefix}:body"),
                    "Description",
                    "",
                    "Description",
                    window,
                    cx,
                ));
            if !options.issue_types.is_empty() {
                form = form.child(self.field(
                    &format!("{prefix}:type"),
                    "Type",
                    &options.issue_types[0],
                    "Issue type",
                    window,
                    cx,
                ));
                form = form.child(self.work_field_choices(
                    &format!("{prefix}:type"),
                    &options.issue_types,
                    cx,
                ));
            }
            if options.assignees {
                form = form.child(self.field(
                    &format!("{prefix}:assignees"),
                    "Assignees",
                    "",
                    "Comma-separated account IDs",
                    window,
                    cx,
                ));
            }
            if options.labels {
                form = form.child(self.field(
                    &format!("{prefix}:labels"),
                    "Labels",
                    "",
                    "Comma-separated labels",
                    window,
                    cx,
                ));
            }
        } else {
            form = form.child(Self::header(
                "Run pipeline",
                "Choose a workflow and branch. Inputs are a JSON object with string values.",
            ));
            let definitions = self
                .responses
                .get(&format!("work-definitions:{scope}"))
                .cloned();
            let items = definitions
                .as_ref()
                .and_then(|v| v.get("items"))
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let initial = items
                .first()
                .and_then(|v| v.get("id"))
                .and_then(Value::as_str)
                .unwrap_or_default();
            form = form.child(self.field(
                &format!("{prefix}:definition"),
                "Workflow",
                initial,
                "Workflow ID or file name",
                window,
                cx,
            ));
            form = form.children(
                definitions
                    .as_ref()
                    .and_then(|v| v.get("hint"))
                    .and_then(Value::as_str)
                    .map(str::to_owned),
            );
            for item in items {
                let Some(id) = item.get("id").and_then(Value::as_str).map(str::to_owned) else {
                    continue;
                };
                let name = item
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or(&id)
                    .to_owned();
                let field = format!("{prefix}:definition");
                let mut row = div().flex().gap_2().child(
                    Button::new(SharedString::from(format!("workflow:{id}")))
                        .label(format!(
                            "{name} · {}",
                            item.get("state")
                                .and_then(Value::as_str)
                                .unwrap_or_default()
                        ))
                        .on_click(cx.listener({
                            let id = id.clone();
                            move |this, _, window, cx| {
                                if let Some(input) = this.inputs.get(&field) {
                                    input.update(cx, |input, cx| {
                                        input.set_value(id.clone(), window, cx)
                                    });
                                }
                                cx.notify();
                            }
                        })),
                );
                for action in ["enable", "disable"] {
                    if options.pipeline_actions.iter().any(|v| v == action) {
                        let source = source.clone();
                        let id = id.clone();
                        let request = format!("work-definition-action:{scope}:{id}");
                        row = row.child(
                            Button::new(SharedString::from(format!("{action}:{id}")))
                                .label(action)
                                .disabled(!self.online || self.pending.contains(&request))
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    let mut input = source.input();
                                    input["action"] = json!(action);
                                    input["id"] = json!(id);
                                    this.request(
                                        request.clone(),
                                        "/api/scm/work/pipelines/action",
                                        input,
                                    );
                                    cx.notify();
                                })),
                        );
                    }
                }
                form = form.child(row);
            }
            if let Some(cursor) = definitions
                .as_ref()
                .and_then(|v| v.get("next"))
                .filter(|v| v.is_string())
                .cloned()
            {
                let source = source.clone();
                let scope = scope.clone();
                form = form.child(
                    Button::new("workflow-more")
                        .label("More workflows")
                        .disabled(
                            !self.online
                                || self
                                    .pending
                                    .contains(&format!("work-definitions-more:{scope}")),
                        )
                        .on_click(cx.listener(move |this, _, _, cx| {
                            let mut input = source.input();
                            input["cursor"] = cursor.clone();
                            this.request(
                                format!("work-definitions-more:{scope}"),
                                "/api/scm/work/pipelines/definitions",
                                input,
                            );
                            cx.notify();
                        })),
                );
            }
            let branch = self
                .snapshot
                .as_ref()
                .and_then(|s| {
                    s.workspace
                        .repositories
                        .iter()
                        .find(|repo| source == &WorkSource::Repository(repo.id.clone()))
                })
                .map(|repo| repo.branch.clone())
                .unwrap_or_default();
            form = form
                .child(self.field(
                    &format!("{prefix}:ref"),
                    "Branch or ref",
                    &branch,
                    "main",
                    window,
                    cx,
                ))
                .child(self.text_field(
                    &format!("{prefix}:inputs"),
                    "Inputs",
                    "{}",
                    "{}",
                    window,
                    cx,
                ));
        }
        let source = source.clone();
        let key = format!("work-form-submit:{scope}");
        let ready = page == Page::Issues
            || self
                .responses
                .contains_key(&format!("work-definitions:{scope}"));
        form = form
            .child(
                Button::new("work-form-submit")
                    .primary()
                    .label(if page == Page::Issues {
                        "Create issue"
                    } else {
                        "Run pipeline"
                    })
                    .disabled(!self.online || !ready || self.pending.contains(&key))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        let result = (|| -> anyhow::Result<Value> {
                            let mut input = source.input();
                            if page == Page::Issues {
                                let title = this.value(&format!("{prefix}:title"), cx);
                                anyhow::ensure!(!title.trim().is_empty(), "Enter an issue title");
                                input["title"] = json!(title.trim());
                                input["body"] =
                                    json!(this.text_value(&format!("{prefix}:body"), cx));
                                let kind = this.value(&format!("{prefix}:type"), cx);
                                if !kind.trim().is_empty() {
                                    input["type"] = json!(kind.trim());
                                }
                                if options.assignees {
                                    input["assignees"] = json!(split_names(
                                        &this.value(&format!("{prefix}:assignees"), cx),
                                        20,
                                        300
                                    )?);
                                }
                                if options.labels {
                                    input["labels"] = json!(split_names(
                                        &this.value(&format!("{prefix}:labels"), cx),
                                        100,
                                        100
                                    )?);
                                }
                            } else {
                                let definition = this.value(&format!("{prefix}:definition"), cx);
                                let branch = this.value(&format!("{prefix}:ref"), cx);
                                anyhow::ensure!(
                                    !definition.trim().is_empty() && !branch.trim().is_empty(),
                                    "Choose a workflow and branch"
                                );
                                input["action"] = json!("run");
                                input["definition"] = json!(definition.trim());
                                input["ref"] = json!(branch.trim());
                                input["inputs"] = json!(pipeline_inputs(
                                    &this.text_value(&format!("{prefix}:inputs"), cx)
                                )?);
                            }
                            Ok(input)
                        })();
                        match result {
                            Ok(input) => {
                                if this.pending.contains(&key) {
                                    return;
                                }
                                this.work_form_submissions.insert(
                                    key.clone(),
                                    (page, source.clone(), this.form_fields(&prefix, cx)),
                                );
                                this.request(
                                    key.clone(),
                                    if page == Page::Issues {
                                        "/api/scm/work/issues/create"
                                    } else {
                                        "/api/scm/work/pipelines/action"
                                    },
                                    input,
                                )
                            }
                            Err(error) => this.error = Some(error.to_string()),
                        }
                        cx.notify();
                    })),
            )
            .child(
                Button::new("work-form-close")
                    .label("Close form (keep draft)")
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.work_form = None;
                        cx.notify();
                    })),
            );
        form.into_any_element()
    }
    pub(super) fn work_field_choices(
        &self,
        field: &str,
        choices: &[String],
        cx: &mut Context<Self>,
    ) -> AnyElement {
        div()
            .flex()
            .flex_wrap()
            .gap_2()
            .children(choices.iter().map(|choice| {
                let field = field.to_owned();
                let choice = choice.clone();
                Button::new(SharedString::from(format!("{field}:{choice}")))
                    .label(if choice.is_empty() {
                        "Inherit".to_owned()
                    } else {
                        choice.clone()
                    })
                    .selected(self.value(&field, cx) == choice)
                    .on_click(cx.listener(move |this, _, window, cx| {
                        if let Some(input) = this.inputs.get(&field) {
                            input.update(cx, |input, cx| {
                                input.set_value(choice.clone(), window, cx)
                            });
                        }
                        cx.notify();
                    }))
            }))
            .into_any_element()
    }
    pub(super) fn issue_edit_fields(
        &mut self,
        source: &WorkSource,
        prefix: &str,
        issue: &scm_work::Issue,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let options = self.work_options(Page::Issues, source);
        let mut fields = div()
            .flex()
            .flex_col()
            .gap_3()
            .child(self.work_field_choices(&format!("{prefix}:state"), &options.issue_states, cx));
        if options.assignees {
            fields = fields.child(self.field(
                &format!("{prefix}:assignees"),
                "Assignees",
                &issue.assignees.join(", "),
                "Comma-separated account IDs",
                window,
                cx,
            ));
        }
        if options.labels {
            fields = fields.child(self.field(
                &format!("{prefix}:labels"),
                "Labels",
                &issue.labels.join(", "),
                "Comma-separated labels",
                window,
                cx,
            ));
        }
        fields.into_any_element()
    }
    pub(super) fn issue_edit_names(
        &self,
        source: &WorkSource,
        prefix: &str,
        input: &mut Value,
        cx: &App,
    ) -> anyhow::Result<()> {
        let options = self.work_options(Page::Issues, source);
        if options.assignees {
            input["assignees"] = json!(split_names(
                &self.value(&format!("{prefix}:assignees"), cx),
                20,
                300
            )?);
        }
        if options.labels {
            input["labels"] = json!(split_names(
                &self.value(&format!("{prefix}:labels"), cx),
                100,
                100
            )?);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{WorkList, WorkSource, append_page, pipeline_inputs};
    use serde_json::json;
    #[test]
    fn obsolete_filter_and_page_responses_cannot_replace_new_results() {
        let mut list = WorkList::default();
        let first = list.begin("issues", json!({"state":"open"}), false);
        let second = list.begin("issues", json!({"state":"closed"}), false);
        assert!(!list.receive(&first, &json!({"items":[{"id":"old"}]})));
        assert!(list.receive(&second, &json!({"items":[{"id":"new"}],"next":"cursor"})));
        let more = list.begin("issues", json!({"state":"closed"}), true);
        let refresh = list.begin("issues", json!({"state":"all"}), false);
        assert!(!list.receive(&more, &json!({"items":[{"id":"old-page"}]})));
        assert!(list.receive(&refresh, &json!({"items":[{"id":"current"}]})));
        assert_eq!(list.page.unwrap()["items"][0]["id"], "current");
    }
    #[test]
    fn pagination_deduplicates_updates_and_preserves_cache_warnings() {
        let merged = append_page(
            Some(
                &json!({"items":[{"id":"1","title":"old"},{"id":"2"}],"stale":true,"refreshError":"offline","cachedAt":"2026-01-01"}),
            ),
            &json!({"items":[{"id":"1","title":"new"},{"id":"3"}],"cachedAt":"2026-02-01","next":"next"}),
            "items",
        );
        assert_eq!(merged["items"].as_array().unwrap().len(), 3);
        assert_eq!(merged["items"][0]["title"], "new");
        assert_eq!(merged["stale"], true);
        assert_eq!(merged["refreshError"], "offline");
        assert_eq!(merged["cachedAt"], "2026-01-01");
        assert_eq!(merged["next"], "next");
    }
    #[test]
    fn targets_and_pipeline_inputs_preserve_the_runtime_contract() {
        assert_eq!(
            WorkSource::Jira("source".into()).input(),
            json!({"jiraSourceId":"source"})
        );
        assert_eq!(
            WorkSource::Repository("repo".into()).input(),
            json!({"repositoryId":"repo"})
        );
        assert_eq!(
            pipeline_inputs("{\"version\":\"1\"}").unwrap()["version"],
            "1"
        );
        assert!(pipeline_inputs("{\"version\":1}").is_err());
        assert!(pipeline_inputs("[]").is_err());
        assert!(pipeline_inputs("{\"\":\"value\"}").is_err());
    }
}
