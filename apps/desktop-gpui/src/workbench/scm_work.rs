use super::scm_lists::WorkSource;
use super::*;
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IssueDetail {
    issue: Issue,
    comments: Vec<Comment>,
    discussion_notice: Option<String>,
    refresh_error: Option<String>,
    next: Option<String>,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Issue {
    id: String,
    title: String,
    url: String,
    body: String,
    state: String,
    revision: String,
    #[serde(default = "markdown")]
    body_format: String,
    preview: Option<String>,
    body_notice: Option<String>,
    pub(super) assignees: Vec<String>,
    pub(super) labels: Vec<String>,
}
fn markdown() -> String {
    "markdown".into()
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Comment {
    id: String,
    author: String,
    body: String,
    created_at: String,
    #[serde(default = "markdown")]
    body_format: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PipelineDetail {
    run: Pipeline,
    jobs: Vec<Job>,
    refresh_error: Option<String>,
    next: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Pipeline {
    title: String,
    url: String,
    status: String,
    #[serde(rename = "ref")]
    branch: String,
    sha: String,
    actor: String,
    created_at: String,
    #[serde(default)]
    errors: Vec<String>,
}
#[derive(Deserialize)]
struct Job {
    id: String,
    url: String,
    name: String,
    status: String,
    #[serde(default)]
    errors: Vec<String>,
    #[serde(default)]
    steps: Vec<Step>,
}
#[derive(Deserialize)]
struct Step {
    name: String,
    status: String,
    #[serde(default)]
    errors: Vec<String>,
}
impl Workbench {
    fn work_open_source(url: &str) -> AnyElement {
        let url = url.to_owned();
        Button::new("work-open-source")
            .label("Open in source")
            .on_click(move |_, _, cx| {
                if url::Url::parse(&url).is_ok_and(|url| {
                    matches!(url.scheme(), "http" | "https")
                        && url.username().is_empty()
                        && url.password().is_none()
                }) {
                    cx.open_url(&url);
                }
            })
            .into_any_element()
    }
    fn work_detail_more(
        &self,
        base: &str,
        source: &WorkSource,
        id: &str,
        area: &'static str,
        cursor: Option<String>,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let Some(cursor) = cursor else {
            return div().into_any_element();
        };
        let key = format!("work-detail-more:{base}");
        let base = base.to_owned();
        let source = source.clone();
        let id = id.to_owned();
        Button::new("work-detail-more")
            .label(if area == "issues" {
                "More comments"
            } else {
                "More jobs"
            })
            .disabled(!self.online || self.pending.contains(&key) || self.pending.contains(&base))
            .on_click(cx.listener(move |this, _, _, cx| {
                if let Some(before) = this.responses.get(&base).cloned() {
                    this.responses
                        .insert(format!("work-detail-before:{base}"), before);
                }
                let mut input = source.input();
                input["id"] = json!(id);
                input["cursor"] = json!(cursor);
                this.request(key.clone(), &format!("/api/scm/work/{area}/detail"), input);
                cx.notify();
            }))
            .into_any_element()
    }
    fn work_source_link(
        &self,
        source: &WorkSource,
        id: &str,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let WorkSource::Jira(source) = source else {
            return div().into_any_element();
        };
        let linked = self
            .snapshot
            .as_ref()
            .and_then(|s| s.workspace.extra.get("jiraIssueLinks"))
            .and_then(Value::as_array)
            .and_then(|links| {
                links.iter().find(|link| {
                    link.get("sourceId").and_then(Value::as_str) == Some(source)
                        && link.get("issueId").and_then(Value::as_str) == Some(id)
                })
            })
            .and_then(|link| link.get("repositoryId"))
            .and_then(Value::as_str);
        let mut choices = div()
            .flex()
            .flex_wrap()
            .gap_2()
            .child("Project for agent tasks:");
        if let Some(snapshot) = &self.snapshot {
            for repo in &snapshot.workspace.repositories {
                let source = source.clone();
                let id = id.to_owned();
                let repository = repo.id.clone();
                let key = format!("work-jira-link:{source}:{id}");
                choices = choices.child(
                    Button::new(SharedString::from(format!("jira-link:{}", repo.id)))
                        .label(repo.name.clone())
                        .selected(linked == Some(repo.id.as_str()))
                        .disabled(!self.online || self.pending.contains(&key))
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.request(
                                key.clone(),
                                "/api/scm/jira/issues/link",
                                json!({"sourceId":source,"issueId":id,"repositoryId":repository}),
                            );
                            cx.notify();
                        })),
                );
            }
        }
        if linked.is_some() {
            let source = source.clone();
            let id = id.to_owned();
            let key = format!("work-jira-link:{source}:{id}");
            choices = choices.child(
                Button::new("jira-unlink")
                    .label("Unlink")
                    .disabled(!self.online || self.pending.contains(&key))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.request(
                            key.clone(),
                            "/api/scm/jira/issues/link",
                            json!({"sourceId":source,"issueId":id,"repositoryId":null}),
                        );
                        cx.notify();
                    })),
            );
        }
        choices.into_any_element()
    }
    fn work_task_button(
        &mut self,
        source: &WorkSource,
        id: &str,
        url: &str,
        kind: &str,
        revision: &str,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let repository = match source {
            WorkSource::Repository(repository) => Some(repository.clone()),
            WorkSource::Jira(source) => self
                .snapshot
                .as_ref()
                .and_then(|s| s.workspace.extra.get("jiraIssueLinks"))
                .and_then(Value::as_array)
                .and_then(|links| {
                    links.iter().find(|link| {
                        link.get("sourceId").and_then(Value::as_str) == Some(source)
                            && link.get("issueId").and_then(Value::as_str) == Some(id)
                    })
                })
                .and_then(|link| link.get("repositoryId"))
                .and_then(Value::as_str)
                .map(str::to_owned),
        };
        let key = format!("work-task:{kind}:{source}:{id}:{revision}");
        let request_id = *self
            .work_task_requests
            .entry(key.clone())
            .or_insert_with(uuid::Uuid::new_v4);
        let mut input =
            json!({"repositoryId":repository,"id":id,"url":url,"kind":kind,"requestId":request_id});
        if let WorkSource::Jira(source) = source {
            input["jiraSourceId"] = json!(source);
        }
        input[if kind == "issue" { "revision" } else { "sha" }] = json!(revision);
        Button::new("work-create-task")
            .label("Create agent task")
            .disabled(!self.online || repository.is_none() || self.pending.contains(&key))
            .on_click(cx.listener(move |this, _, _, cx| {
                this.request(key.clone(), "/api/scm/work/task", input.clone());
                cx.notify();
            }))
            .into_any_element()
    }
    pub(super) fn refresh_work_action(&mut self, key: &str) {
        if let Some(source) = key.strip_prefix("work-edit:") {
            self.work_issue_rebase
                .insert(format!("issue-edit:{source}"));
        }
        let Some((page, repository, id)) = self.selected_work.clone() else {
            return;
        };
        if ["work-comment", "work-edit", "work-pipeline-action"]
            .iter()
            .any(|prefix| {
                key == format!("{prefix}:{repository}:{id}")
                    || key.starts_with(&format!("{prefix}:{repository}:{id}:"))
            })
        {
            let area = if page == Page::Issues {
                "issues"
            } else {
                "pipelines"
            };
            self.request(
                format!("work-detail:{area}:{repository}:{id}"),
                &format!("/api/scm/work/{area}/detail"),
                {
                    let mut input = repository.input();
                    input["id"] = json!(id);
                    input["refresh"] = json!(true);
                    input
                },
            );
        }
    }

    pub(super) fn work_detail(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let Some((page, repository, id)) = self.selected_work.clone() else {
            return Self::empty("Choose an item", "Select an issue or pipeline.");
        };
        let area = if page == Page::Issues {
            "issues"
        } else {
            "pipelines"
        };
        let key = format!("work-detail:{area}:{repository}:{id}");
        let mut root = div()
            .id("work-detail")
            .flex()
            .flex_col()
            .flex_1()
            .overflow_y_scroll()
            .p_5()
            .gap_4();
        let refresh_key = key.clone();
        let refresh_repository = repository.clone();
        let refresh_id = id.clone();
        root = root.child(
            div()
                .flex()
                .gap_2()
                .child(
                    Button::new("work-back")
                        .label("Back to list")
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.selected_work = None;
                            cx.notify();
                        })),
                )
                .child(
                    Button::new("work-refresh")
                        .label("Refresh")
                        .disabled(!self.online || self.pending.contains(&key))
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.request(
                                refresh_key.clone(),
                                &format!("/api/scm/work/{area}/detail"),
                                {
                                    let mut input = refresh_repository.input();
                                    input["id"] = json!(refresh_id);
                                    input["refresh"] = json!(true);
                                    input
                                },
                            );
                            cx.notify();
                        })),
                ),
        );
        let Some(value) = self.responses.get(&key).cloned() else {
            return root.child("Loading details…").into_any_element();
        };
        if page == Page::Issues {
            let detail: IssueDetail = match serde_json::from_value(value) {
                Ok(detail) => detail,
                Err(error) => {
                    return root
                        .child(format!("Invalid issue response: {error}"))
                        .into_any_element();
                }
            };
            let issue = detail.issue;
            root = root.child(self.work_source_link(&repository, &id, cx));
            root = root.child(Self::work_open_source(&issue.url));
            root = root.child(self.work_detail_more(&key, &repository, &id, area, detail.next, cx));
            root = root.child(self.work_task_button(
                &repository,
                &id,
                &issue.url,
                "issue",
                &issue.revision,
                cx,
            ));
            root = root.child(Self::header(
                &issue.title,
                &format!("{} · {}", issue.id, issue.state),
            ));
            for notice in [
                detail.refresh_error,
                detail.discussion_notice,
                issue.body_notice.clone(),
            ]
            .into_iter()
            .flatten()
            {
                root = root.child(notice);
            }
            root = root.child(format!(
                "Assignees: {} · Labels: {}",
                issue.assignees.join(", "),
                issue.labels.join(", ")
            ));
            root = root.child(if issue.body_format == "markdown" {
                TextView::markdown("issue-body", issue.body.clone())
                    .selectable(true)
                    .into_any_element()
            } else {
                div()
                    .child(issue.preview.clone().unwrap_or_else(|| {
                        "Open the issue in its source to read the formatted description.".into()
                    }))
                    .into_any_element()
            });
            for comment in detail.comments {
                let body = if comment.body_format == "markdown" {
                    TextView::markdown(
                        SharedString::from(format!("issue-comment:{}", comment.id)),
                        comment.body,
                    )
                    .selectable(true)
                    .into_any_element()
                } else {
                    div()
                        .child("Formatted comment available in the source issue.")
                        .into_any_element()
                };
                root = root.child(
                    div()
                        .p_3()
                        .border_1()
                        .border_color(cx.theme().border)
                        .rounded_md()
                        .child(format!("{} · {}", comment.author, comment.created_at))
                        .child(body),
                );
            }
            let comment_key = format!("issue-comment:{repository}:{id}");
            root = root.child(self.text_field(
                &comment_key,
                "Add comment",
                "",
                "Write a comment",
                window,
                cx,
            ));
            let comment_repository = repository.clone();
            let comment_id = id.clone();
            let revision = issue.revision.clone();
            root = root.child(
                Button::new("issue-post-comment")
                    .label("Post comment")
                    .disabled(
                        !self.online
                            || self
                                .pending
                                .contains(&format!("work-comment:{repository}:{id}")),
                    )
                    .on_click(cx.listener(move |this, _, _, cx| {
                        let body = this.text_value(&comment_key, cx);
                        if body.trim().is_empty() {
                            this.error = Some("Write a comment first".into());
                        } else {
                            this.pending_text_submissions.insert(
                                format!("work-comment:{comment_repository}:{comment_id}"),
                                (comment_key.clone(), body.clone()),
                            );
                            this.request(
                                format!("work-comment:{comment_repository}:{comment_id}"),
                                "/api/scm/work/issues/action",
                                {
                                    let mut input = comment_repository.input();
                                    input["id"] = json!(comment_id);
                                    input["revision"] = json!(revision);
                                    input["action"] = json!("comment");
                                    input["body"] = json!(body);
                                    input
                                },
                            );
                        }
                        cx.notify();
                    })),
            );
            let prefix = format!("issue-edit:{repository}:{id}");
            let baseline = self
                .work_issue_baselines
                .entry(prefix.clone())
                .or_insert_with(|| issue.clone())
                .clone();
            if baseline.revision != issue.revision {
                root = root.child("The source changed. Your editor draft is preserved; reload it before editing the new revision.");
            }
            let reload_prefix = prefix.clone();
            root = root.child(Button::new("issue-reload-editor").label("Reload editor…").on_click(cx.listener(move |this,_,window,cx| {
                let generation=this.generation;let source_epoch=this.source_epoch();
                let prompt=window.prompt(PromptLevel::Warning,"Reload issue editor?",Some("Unsaved edits will be discarded and replaced with the current source fields."),&["Keep edits","Reload editor"],cx);
                let prefix=reload_prefix.clone();
                cx.spawn(async move |this,cx| {if prompt.await==Ok(1) {let _=this.update(cx,|this,cx| {
                    if generation!=this.generation || source_epoch!=this.source_epoch() {return;}
                    this.work_issue_baselines.remove(&prefix);
                    for field in ["title","state","body","assignees","labels"] {this.inputs.remove(&format!("{prefix}:{field}"));this.textareas.remove(&format!("{prefix}:{field}"));}
                    cx.notify();
                });}}).detach();
            })));
            let issue = baseline;
            root = root.child(self.issue_edit_fields(&repository, &prefix, &issue, window, cx));
            root = root
                .child(Self::header(
                    "Edit issue",
                    "The source revision is checked before saving.",
                ))
                .child(self.field(
                    &format!("{prefix}:title"),
                    "Title",
                    &issue.title,
                    "Issue title",
                    window,
                    cx,
                ))
                .child(self.field(
                    &format!("{prefix}:state"),
                    "State",
                    &issue.state,
                    "Issue state",
                    window,
                    cx,
                ));
            if issue.body_format == "markdown" {
                root = root.child(self.text_field(
                    &format!("{prefix}:body"),
                    "Description",
                    &issue.body,
                    "Description",
                    window,
                    cx,
                ));
            }
            root = root.child(
                Button::new("issue-save")
                    .primary()
                    .label("Save issue")
                    .disabled(
                        !self.online
                            || self
                                .pending
                                .contains(&format!("work-edit:{repository}:{id}")),
                    )
                    .on_click(cx.listener(move |this, _, _, cx| {
                        let title = this.value(&format!("{prefix}:title"), cx);
                        let state = this.value(&format!("{prefix}:state"), cx);
                        if title.trim().is_empty() || state.trim().is_empty() {
                            this.error = Some("Title and state are required".into());
                        } else {
                            let mut input = repository.input();
                            input["id"] = json!(id);
                            input["revision"] = json!(issue.revision);
                            input["action"] = json!("edit");
                            input["title"] = json!(title);
                            input["state"] = json!(state);
                            if let Err(error) =
                                this.issue_edit_names(&repository, &prefix, &mut input, cx)
                            {
                                this.error = Some(error.to_string());
                                cx.notify();
                                return;
                            }
                            if issue.body_format == "markdown" {
                                input["body"] =
                                    json!(this.text_value(&format!("{prefix}:body"), cx));
                            }
                            this.request(
                                format!("work-edit:{repository}:{id}"),
                                "/api/scm/work/issues/action",
                                input,
                            );
                        }
                        cx.notify();
                    })),
            );
        } else {
            let detail: PipelineDetail = match serde_json::from_value(value) {
                Ok(detail) => detail,
                Err(error) => {
                    return root
                        .child(format!("Invalid pipeline response: {error}"))
                        .into_any_element();
                }
            };
            root = root.child(Self::work_open_source(&detail.run.url));
            root = root.child(self.work_detail_more(&key, &repository, &id, area, detail.next, cx));
            root = root.child(self.work_task_button(
                &repository,
                &id,
                &detail.run.url,
                "pipeline",
                &detail.run.sha,
                cx,
            ));
            root = root
                .child(Self::header(&detail.run.title, &detail.run.status))
                .child(format!(
                    "{} · {} · {} · {}",
                    detail.run.branch, detail.run.sha, detail.run.actor, detail.run.created_at
                ));
            for notice in detail.refresh_error.into_iter().chain(detail.run.errors) {
                root = root.child(notice);
            }
            let actions = self
                .responses
                .get(&format!("work-options:{repository}:{}", page.label()))
                .and_then(|value| value.get("pipelineActions"))
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let mut toolbar = div().flex().gap_2();
            for action in ["rerun", "cancel"] {
                if !actions.iter().any(|value| value.as_str() == Some(action)) {
                    continue;
                }
                let action_repository = repository.clone();
                let action_id = id.clone();
                let request_key = format!("work-pipeline-action:{repository}:{id}:{action}");
                toolbar = toolbar.child(
                    Button::new(action)
                        .label(if action == "rerun" {
                            "Rerun pipeline"
                        } else {
                            "Cancel pipeline…"
                        })
                        .disabled(
                            !self.online
                                || self.pending.iter().any(|key| {
                                    key.starts_with(&format!(
                                        "work-pipeline-action:{repository}:{id}:"
                                    ))
                                }),
                        )
                        .on_click(cx.listener(move |this, _, window, cx| {
                            let mut input = action_repository.input();
                            input["id"] = json!(action_id);
                            input["action"] = json!(action);
                            if action == "cancel" {
                                let prompt = window.prompt(
                                    PromptLevel::Warning,
                                    "Cancel this pipeline?",
                                    Some("The provider will stop the selected run."),
                                    &["Keep running", "Cancel pipeline"],
                                    cx,
                                );
                                let key = request_key.clone();
                                let generation = this.generation;
                                let source_epoch = this.source_epoch();
                                cx.spawn(async move |this, cx| {
                                    if prompt.await == Ok(1) {
                                        let _ = this.update(cx, |this, cx| {
                                            if this.generation == generation
                                                && this.source_epoch() == source_epoch
                                            {
                                                this.request(
                                                    key,
                                                    "/api/scm/work/pipelines/action",
                                                    input,
                                                );
                                                cx.notify();
                                            }
                                        });
                                    }
                                })
                                .detach();
                            } else {
                                this.request(
                                    request_key.clone(),
                                    "/api/scm/work/pipelines/action",
                                    input,
                                );
                            }
                            cx.notify();
                        })),
                );
            }
            root = root.child(toolbar);
            for job in detail.jobs {
                let mut card = div()
                    .id(SharedString::from(format!("pipeline-job:{}", job.id)))
                    .p_3()
                    .border_1()
                    .border_color(cx.theme().border)
                    .rounded_md()
                    .flex()
                    .flex_col()
                    .gap_2()
                    .child(format!("{} · {}", job.name, job.status))
                    .children(job.errors)
                    .child(
                        Button::new(SharedString::from(format!("pipeline-logs:{}", job.id)))
                            .label("Open logs")
                            .on_click(move |_, _, cx| {
                                if url::Url::parse(&job.url).is_ok_and(|url| {
                                    matches!(url.scheme(), "http" | "https")
                                        && url.username().is_empty()
                                        && url.password().is_none()
                                }) {
                                    cx.open_url(&job.url);
                                }
                            }),
                    );
                for step in job.steps {
                    card = card
                        .child(format!("{} · {}", step.name, step.status))
                        .children(step.errors);
                }
                root = root.child(card);
            }
        }
        root.into_any_element()
    }
}
