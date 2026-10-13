use super::scm_lists::WorkSource;
use super::*;
use crate::model::{PullCapabilities, PullComment, PullInfo};

fn supports(capabilities: &PullCapabilities, action: &str) -> bool {
    capabilities
        .actions
        .iter()
        .any(|candidate| candidate == action)
}
fn names(text: &str) -> anyhow::Result<Vec<String>> {
    let values: Vec<_> = text
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .collect();
    anyhow::ensure!(values.len() <= 30, "Use at most 30 reviewers or teams");
    Ok(values)
}
fn lines(start: &str, end: &str, ranges: bool) -> anyhow::Result<(u64, u64)> {
    let start = start.trim().parse::<u64>()?;
    let end = if end.trim().is_empty() {
        start
    } else {
        end.trim().parse::<u64>()?
    };
    anyhow::ensure!(
        start > 0 && end >= start,
        "Choose a positive start line and an end line at or after it"
    );
    anyhow::ensure!(
        ranges || start == end,
        "This forge supports single-line comments only"
    );
    Ok((start, end))
}

impl Workbench {
    pub(super) fn receive_pull_action(&mut self, key: &str, value: &Value) {
        if let Some(source) = key.strip_prefix("pull-action:")
            && let Some((repository, number)) = source.rsplit_once(':')
            && let Ok(number) = number.parse::<u64>()
        {
            if let Some(prefix) = self
                .responses
                .remove(&format!("pull-edit-submission:{key}"))
                .and_then(|v| v.as_str().map(str::to_owned))
            {
                self.work_issue_rebase.insert(prefix);
            }
            self.notice = Some("Pull request action completed".into());
            self.request(
                format!("pull-detail:{repository}:{number}"),
                "/api/scm/pulls/detail",
                json!({"repositoryId":repository,"number":number,"refresh":true}),
            );
        }
        if let Some(source) = key.strip_prefix("pull-detail:") {
            let baseline = format!("pull-edit:{source}");
            if self.work_issue_rebase.remove(&baseline)
                && let Some(pull) = value.get("pull")
            {
                self.scm_editor_baselines.insert(baseline, pull.clone());
            }
        }
    }
    fn pull_action_button(
        &self,
        repository: &str,
        pull: &PullInfo,
        label: &str,
        action: Value,
        confirm: bool,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let key = format!("pull-action:{repository}:{}", pull.number);
        let mut input = action;
        input["repositoryId"] = json!(repository);
        input["number"] = json!(pull.number);
        input["headSha"] = json!(pull.head_sha);
        let label = label.to_owned();
        let prompt_title = format!("{label}?");
        Button::new(SharedString::from(format!("pull-control:{label}:{}", input.get("threadId").and_then(Value::as_str).unwrap_or("pull")))).label(label).disabled(!self.online||self.pending.contains(&key))
            .on_click(cx.listener(move|this,_,window,cx|{
                if confirm {
                    let prompt=window.prompt(PromptLevel::Warning,&prompt_title,Some("The runtime checks the captured pull request commit before applying this action."),&["Keep pull request","Apply"],cx);
                    let generation=this.generation;let source_epoch=this.source_epoch();let key=key.clone();let input=input.clone();
                    cx.spawn(async move|this,cx|{if prompt.await==Ok(1){let _=this.update(cx,|this,cx|{if this.generation==generation && this.source_epoch()==source_epoch{this.request(key,"/api/scm/pulls/action",input);cx.notify();}});}}).detach();
                }else{this.request(key.clone(),"/api/scm/pulls/action",input.clone());}cx.notify();
            })).into_any_element()
    }
    pub(super) fn pull_actions(
        &mut self,
        repository: &str,
        pull: &PullInfo,
        capabilities: &PullCapabilities,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let prefix = format!("pull-controls:{repository}:{}", pull.number);
        let request = format!("pull-action:{repository}:{}", pull.number);
        let mut root = div().flex().flex_col().gap_3().child(Self::header(
            "Pull request actions",
            "Actions use this displayed commit and the forge's supported operations.",
        ));
        let mut controls = div().flex().flex_wrap().gap_2();
        for (action, label, state) in [
            ("close", "Close pull request", "open"),
            ("reopen", "Reopen pull request", "closed"),
        ] {
            if supports(capabilities, action) && pull.state == state {
                controls = controls.child(self.pull_action_button(
                    repository,
                    pull,
                    label,
                    json!({"action":action}),
                    true,
                    cx,
                ));
            }
        }
        if supports(capabilities, "merge") && pull.state == "open" {
            for method in &capabilities.merge_methods {
                controls = controls.child(self.pull_action_button(
                    repository,
                    pull,
                    &format!("Merge ({method})"),
                    json!({"action":"merge","method":method}),
                    true,
                    cx,
                ));
            }
        }
        root = root.child(controls);
        if supports(capabilities, "comment") || supports(capabilities, "review") {
            let body_key = format!("{prefix}:body");
            root = root.child(self.text_field(
                &body_key,
                "Comment or review",
                "",
                "Review feedback",
                window,
                cx,
            ));
            let mut choices = div().flex().flex_wrap().gap_2();
            let mut actions = Vec::new();
            if supports(capabilities, "comment") {
                actions.push(("Post comment".to_owned(), json!({"action":"comment"})));
            }
            if supports(capabilities, "review") {
                for event in &capabilities.review_decisions {
                    actions.push((
                        format!("Review: {event}"),
                        json!({"action":"review","event":event}),
                    ));
                }
            }
            for (label, mut action) in actions {
                let body_key = body_key.clone();
                let key = request.clone();
                let head = pull.head_sha.clone();
                let number = pull.number;
                let repository = repository.to_owned();
                action["repositoryId"] = json!(repository);
                action["number"] = json!(number);
                action["headSha"] = json!(head);
                choices = choices.child(
                    Button::new(SharedString::from(label.clone()))
                        .label(label)
                        .disabled(!self.online || self.pending.contains(&key))
                        .on_click(cx.listener(move |this, _, _, cx| {
                            let body = this.text_value(&body_key, cx);
                            if body.trim().is_empty()
                                && action.get("event").and_then(Value::as_str) != Some("approve")
                            {
                                this.error = Some("Write feedback first".into());
                                cx.notify();
                                return;
                            }
                            let mut input = action.clone();
                            input["body"] = json!(body);
                            this.pending_text_submissions
                                .insert(key.clone(), (body_key.clone(), body));
                            this.request(key.clone(), "/api/scm/pulls/action", input);
                            cx.notify();
                        })),
                );
            }
            root = root.child(choices);
        }
        if supports(capabilities, "reviewers") {
            root = root
                .child(self.field(
                    &format!("{prefix}:reviewers"),
                    "Reviewer account IDs",
                    "",
                    "Comma-separated accounts",
                    window,
                    cx,
                ))
                .child(self.field(
                    &format!("{prefix}:teams"),
                    "Reviewer teams",
                    "",
                    "Comma-separated team IDs",
                    window,
                    cx,
                ));
            for operation in ["add", "remove"] {
                let prefix = prefix.clone();
                let key = request.clone();
                let repository = repository.to_owned();
                let head = pull.head_sha.clone();
                let number = pull.number;
                root=root.child(Button::new(operation).label(format!("{operation} reviewers")).disabled(!self.online||self.pending.contains(&key)).on_click(cx.listener(move|this,_,_,cx|{
                    let result=(||->anyhow::Result<Value>{let reviewers=names(&this.value(&format!("{prefix}:reviewers"),cx))?;let teams=names(&this.value(&format!("{prefix}:teams"),cx))?;anyhow::ensure!(!reviewers.is_empty()||!teams.is_empty(),"Enter a reviewer or team");Ok(json!({"repositoryId":repository,"number":number,"headSha":head,"action":"reviewers","operation":operation,"reviewers":reviewers,"teams":teams}))})();
                    match result{Ok(input)=>this.request(key.clone(),"/api/scm/pulls/action",input),Err(error)=>this.error=Some(error.to_string())}cx.notify();
                })));
            }
        }
        if supports(capabilities, "edit") {
            let prefix = format!("pull-edit:{repository}:{}", pull.number);
            let before=self.scm_editor_baselines.entry(prefix.clone()).or_insert_with(||json!({"title":pull.title,"body":pull.body,"base":pull.base,"headSha":pull.head_sha})).clone();
            let text = |field: &str| {
                before
                    .get(field)
                    .and_then(Value::as_str)
                    .unwrap_or_default()
            };
            root = root
                .child(self.field(
                    &format!("{prefix}:title"),
                    "Title",
                    text("title"),
                    "Pull request title",
                    window,
                    cx,
                ))
                .child(self.field(
                    &format!("{prefix}:base"),
                    "Target branch",
                    text("base"),
                    "Target branch",
                    window,
                    cx,
                ))
                .child(self.text_field(
                    &format!("{prefix}:body"),
                    "Description",
                    text("body"),
                    "Description",
                    window,
                    cx,
                ));
            if text("headSha") != pull.head_sha {
                root =
                    root.child("The source commit changed; reload the edit draft before saving.");
            }
            let reload_prefix = prefix.clone();
            let live = json!({"title":pull.title,"body":pull.body,"base":pull.base,"headSha":pull.head_sha});
            root = root.child(
                Button::new("pull-edit-reload")
                    .label("Reload edit draft…")
                    .on_click(cx.listener(move |this, _, window, cx| {
                        let prompt = window.prompt(
                            PromptLevel::Warning,
                            "Reload pull request draft?",
                            Some("Discard unsaved edits and load the displayed fields."),
                            &["Keep edits", "Reload"],
                            cx,
                        );
                        let generation = this.generation;
                        let source_epoch = this.source_epoch();
                        let prefix = reload_prefix.clone();
                        let live = live.clone();
                        cx.spawn(async move |this, cx| {
                            if prompt.await == Ok(1) {
                                let _ = this.update(cx, |this, cx| {
                                    if generation == this.generation
                                        && source_epoch == this.source_epoch()
                                    {
                                        this.inputs.retain(|key, _| {
                                            !key.starts_with(&format!("{prefix}:"))
                                        });
                                        this.textareas.retain(|key, _| {
                                            !key.starts_with(&format!("{prefix}:"))
                                        });
                                        this.scm_editor_baselines.insert(prefix, live);
                                        cx.notify();
                                    }
                                });
                            }
                        })
                        .detach();
                    })),
            );
            let repository = repository.to_owned();
            let number = pull.number;
            let key = request;
            root=root.child(Button::new("pull-edit-save").primary().label("Save pull request").disabled(!self.online||self.pending.contains(&key)).on_click(cx.listener(move|this,_,_,cx|{
                let title=this.value(&format!("{prefix}:title"),cx);let base=this.value(&format!("{prefix}:base"),cx);if title.trim().is_empty()||base.trim().is_empty(){this.error=Some("Enter a title and target branch".into());cx.notify();return;}
                this.responses.insert(format!("pull-edit-submission:{key}"),json!(prefix));
                this.request(key.clone(),"/api/scm/pulls/action",json!({"repositoryId":repository,"number":number,"headSha":before["headSha"],"action":"edit","title":title,"body":this.text_value(&format!("{prefix}:body"),cx),"base":base}));cx.notify();
            })));
        }
        root.into_any_element()
    }
    pub(super) fn pull_comment_actions(
        &mut self,
        repository: &str,
        pull: &PullInfo,
        comment: &PullComment,
        capabilities: &PullCapabilities,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let mut root = div().flex().flex_col().gap_2();
        if supports(capabilities, "resolve")
            && comment.can_resolve == Some(true)
            && let Some(thread) = &comment.thread_id
        {
            root=root.child(self.pull_action_button(repository,pull,if comment.resolved==Some(true){"Reopen discussion"}else{"Resolve discussion"},json!({"action":"resolve","threadId":thread,"resolved":comment.resolved!=Some(true)}),false,cx));
        }
        if supports(capabilities, "reply") && comment.kind == "inline" {
            let field = format!("pull-reply:{repository}:{}:{}", pull.number, comment.id);
            root = root.child(self.text_field(
                &field,
                "Reply",
                "",
                "Reply to this discussion",
                window,
                cx,
            ));
            let key = format!("pull-action:{repository}:{}", pull.number);
            let repository = repository.to_owned();
            let number = pull.number;
            let head = pull.head_sha.clone();
            let comment_id = comment.id.clone();
            let thread = comment.thread_id.clone();
            root=root.child(Button::new(SharedString::from(format!("reply:{comment_id}"))).label("Post reply").disabled(!self.online||self.pending.contains(&key)).on_click(cx.listener(move|this,_,_,cx|{
                let body=this.text_value(&field,cx);if body.trim().is_empty(){this.error=Some("Write a reply first".into());cx.notify();return;}let mut input=json!({"repositoryId":repository,"number":number,"headSha":head,"action":"reply","commentId":comment_id,"body":body});if let Some(thread)=&thread{input["threadId"]=json!(thread);}
                this.pending_text_submissions.insert(key.clone(),(field.clone(),body));this.request(key.clone(),"/api/scm/pulls/action",input);cx.notify();
            })));
        }
        root.into_any_element()
    }
    pub(super) fn pull_inline_form(
        &mut self,
        repository: &str,
        pull: &PullInfo,
        path: &str,
        capabilities: &PullCapabilities,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        if !supports(capabilities, "inline-comment") {
            return div().into_any_element();
        }
        let prefix = format!("pull-inline:{repository}:{}:{path}", pull.number);
        let mut root = div().flex().flex_col().gap_2();
        root = root
            .child(self.field(
                &format!("{prefix}:start"),
                "Comment start line",
                "",
                "Line number in the diff",
                window,
                cx,
            ))
            .child(self.field(
                &format!("{prefix}:end"),
                "End line (optional)",
                "",
                "Single line by default",
                window,
                cx,
            ))
            .child(self.field(
                &format!("{prefix}:side"),
                "Side",
                "additions",
                "additions or deletions",
                window,
                cx,
            ))
            .child(self.work_field_choices(
                &format!("{prefix}:side"),
                &["additions".into(), "deletions".into()],
                cx,
            ))
            .child(self.text_field(
                &format!("{prefix}:body"),
                "Line comment",
                "",
                "Review comment",
                window,
                cx,
            ));
        let key = format!("pull-action:{repository}:{}", pull.number);
        let repository = repository.to_owned();
        let path = path.to_owned();
        let number = pull.number;
        let head = pull.head_sha.clone();
        let ranges = capabilities.inline_range.unwrap_or(false);
        root=root.child(Button::new(SharedString::from(format!("inline-comment:{path}"))).label("Post line comment").disabled(!self.online||self.pending.contains(&key)).on_click(cx.listener(move|this,_,_,cx|{
            let result=(||->anyhow::Result<Value>{let (start,end)=lines(&this.value(&format!("{prefix}:start"),cx),&this.value(&format!("{prefix}:end"),cx),ranges)?;let body=this.text_value(&format!("{prefix}:body"),cx);anyhow::ensure!(!body.trim().is_empty(),"Write a line comment");Ok(json!({"repositoryId":repository,"number":number,"headSha":head,"path":path,"side":this.value(&format!("{prefix}:side"),cx),"start":start,"end":end,"body":body}))})();
            match result{Ok(input)=>{let field=format!("{prefix}:body");this.pending_text_submissions.insert(key.clone(),(field.clone(),this.text_value(&field,cx)));this.request(key.clone(),"/api/scm/pulls/comment",input);},Err(error)=>this.error=Some(error.to_string())}cx.notify();
        })));
        root.into_any_element()
    }
    pub(super) fn pull_create_form(
        &mut self,
        source: &WorkSource,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let scope = Self::work_scope(Page::Pulls, source);
        let prefix = format!("work-form:{scope}");
        let key = format!("work-form-submit:{scope}");
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
        let mut form = div()
            .flex()
            .flex_col()
            .gap_3()
            .p_4()
            .border_1()
            .border_color(cx.theme().border)
            .rounded_md()
            .child(Self::header(
                "New pull request",
                "Publish the selected branch through the configured source account.",
            ))
            .child(self.field(
                &format!("{prefix}:title"),
                "Title",
                "",
                "Pull request title",
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
            ))
            .child(self.field(
                &format!("{prefix}:head"),
                "Source branch",
                &branch,
                "feature/branch",
                window,
                cx,
            ))
            .child(self.field(
                &format!("{prefix}:base"),
                "Target branch",
                "",
                "main",
                window,
                cx,
            ));
        let draft = self
            .responses
            .get(&format!("pull-options:{source}"))
            .and_then(|v| v.get("draft"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if draft {
            form = form
                .child(self.field(
                    &format!("{prefix}:draft"),
                    "Draft",
                    "no",
                    "yes or no",
                    window,
                    cx,
                ))
                .child(self.work_field_choices(
                    &format!("{prefix}:draft"),
                    &["yes".into(), "no".into()],
                    cx,
                ));
        }
        let source = source.clone();
        form = form
            .child(
                Button::new("pull-publish")
                    .primary()
                    .label("Create pull request")
                    .disabled(!self.online || self.pending.contains(&key))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        let title = this.value(&format!("{prefix}:title"), cx);
                        let head = this.value(&format!("{prefix}:head"), cx);
                        let base = this.value(&format!("{prefix}:base"), cx);
                        if title.trim().is_empty()
                            || head.trim().is_empty()
                            || base.trim().is_empty()
                            || head.trim() == base.trim()
                        {
                            this.error =
                                Some("Enter a title and different source/target branches".into());
                            cx.notify();
                            return;
                        }
                        let mut input = source.input();
                        input["title"] = json!(title.trim());
                        input["head"] = json!(head.trim());
                        input["base"] = json!(base.trim());
                        input["body"] = json!(this.text_value(&format!("{prefix}:body"), cx));
                        input["draft"] =
                            json!(draft && this.value(&format!("{prefix}:draft"), cx) == "yes");
                        this.work_form_submissions.insert(
                            key.clone(),
                            (Page::Pulls, source.clone(), this.form_fields(&prefix, cx)),
                        );
                        this.request(key.clone(), "/api/scm/pulls/create", input);
                        cx.notify();
                    })),
            )
            .child(
                Button::new("pull-create-close")
                    .label("Close (keep draft)")
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.work_form = None;
                        cx.notify();
                    })),
            );
        form.into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::lines;
    #[test]
    fn line_reviews_reject_ranges_when_forge_only_supports_single_lines() {
        assert_eq!(lines("5", "", false).unwrap(), (5, 5));
        assert!(lines("0", "", true).is_err());
        assert!(lines("5", "4", true).is_err());
        assert!(lines("5", "6", false).is_err());
        assert_eq!(lines("5", "6", true).unwrap(), (5, 6));
    }
}
