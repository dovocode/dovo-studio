use super::*;
use crate::model::PullDetail;

impl Workbench {
    pub(super) fn pull_detail(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let Some(repository) = self.selected_repository.clone() else {
            return Self::empty(
                "Choose a project",
                "Select a project to review its pull requests.",
            );
        };
        let Some(number) = self.selected_pull else {
            return Self::empty(
                "Choose a pull request",
                "Select a pull request from the list.",
            );
        };
        let key = format!("pull-detail:{repository}:{number}");
        let refresh_repo = repository.clone();
        let mut root = div().id("pull-detail").flex().flex_col().flex_1().min_h_0().overflow_y_scroll().p_5().gap_4()
            .child(div().flex().gap_2()
                .child(Button::new("pull-back").ghost().label("Back to pull requests").on_click(cx.listener(|this,_,_,cx|{ this.selected_pull=None; cx.notify(); })))
                .child(Button::new("pull-refresh").label("Refresh").disabled(self.pending.contains(&key)).on_click(cx.listener(move|this,_,_,cx|{
                    this.request(format!("pull-detail:{refresh_repo}:{number}"),"/api/scm/pulls/detail",json!({"repositoryId":refresh_repo,"number":number,"refresh":true})); cx.notify();
                }))));
        let detail: PullDetail = match self.responses.get(&key) {
            Some(value) => match serde_json::from_value(value.clone()) {
                Ok(detail) => detail,
                Err(error) => {
                    return root
                        .child(format!("Invalid pull request details: {error}"))
                        .into_any_element();
                }
            },
            None => return root.child("Loading pull request…").into_any_element(),
        };
        root = root
            .child(Self::header(
                &format!("#{} {}", detail.pull.number, detail.pull.title),
                &format!(
                    "{} · {} · {} → {}",
                    detail.pull.state, detail.pull.author, detail.pull.head, detail.pull.base
                ),
            ))
            .child(TextView::markdown("pull-body", detail.pull.body.clone()).selectable(true));
        let capabilities = detail.capabilities.clone().unwrap_or_default();
        root = root.child(self.pull_actions(&repository, &detail.pull, &capabilities, window, cx));
        if let Some(stack) = &detail.stack {
            root = root.child(Self::header(
                &format!(
                    "Stack {}/{} · root #{}",
                    stack.position, stack.size, stack.root_number
                ),
                &stack.parent_number.map_or_else(
                    || "Root pull request".into(),
                    |parent| format!("Depends on #{parent}"),
                ),
            ));
            if !stack.complete {
                root = root.child("The detected stack is incomplete. The agent must verify all dependencies before updating branches.");
            }
            for member in &stack.members {
                let repo = repository.clone();
                let target = member.number;
                let url = member.url.clone();
                root = root.child(
                    div()
                        .flex()
                        .flex_col()
                        .gap_1()
                        .pl(px((member.depth.min(10) * 16) as f32))
                        .child(
                            Button::new(SharedString::from(format!("stack-member:{target}")))
                                .label(format!(
                                    "#{} {}{}",
                                    target,
                                    member.title,
                                    if member.draft { " · Draft" } else { "" }
                                ))
                                .selected(target == number)
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.selected_pull = Some(target);
                                    this.selected_agent = None;
                                    this.request(
                                        format!("pull-detail:{repo}:{target}"),
                                        "/api/scm/pulls/detail",
                                        json!({"repositoryId":repo,"number":target}),
                                    );
                                    this.read_task_agents();
                                    cx.notify();
                                })),
                        )
                        .child(format!(
                            "{} → {}{}",
                            member.head,
                            member.base,
                            member
                                .parent_number
                                .map_or_else(String::new, |parent| format!(" · after #{parent}"))
                        ))
                        .child(
                            Button::new(SharedString::from(format!("stack-link:{target}")))
                                .ghost()
                                .label("Open on forge")
                                .on_click(move |_, _, cx| {
                                    if url::Url::parse(&url)
                                        .is_ok_and(|url| matches!(url.scheme(), "http" | "https"))
                                    {
                                        cx.open_url(&url);
                                    }
                                }),
                        ),
                );
            }
            let repo = repository.clone();
            let pull = detail.pull.clone();
            root = root.child(
                Button::new("pull-stack-update")
                    .label("Create stack update task")
                    .disabled(
                        !self.online
                            || self
                                .pending
                                .contains(&format!("pull-task:{repository}:{number}")),
                    )
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.create_pull_task(
                            &repo,
                            &pull,
                            "Update this pull request stack",
                            "new-branch",
                            true,
                            cx,
                        );
                    })),
            );
        }
        for warning in detail.warnings {
            root = root.child(warning);
        }
        if let Some(error) = detail.refresh_error {
            root = root.child(format!("Refresh failed: {error}"));
        }
        root = root.child(Self::header(
            "Checks",
            "Provider-reported build and validation results.",
        ));
        for (index, check) in detail.checks.into_iter().enumerate() {
            let mut card = div()
                .p_3()
                .border_1()
                .border_color(cx.theme().border)
                .rounded_md()
                .flex()
                .flex_col()
                .gap_2()
                .child(format!("{} · {}", check.name, check.status));
            if let Some(summary) = check.summary {
                card = card.child(summary);
            }
            if let Some(details) = check.details {
                card = card.child(
                    TextView::markdown(SharedString::from(format!("check-{index}")), details)
                        .selectable(true),
                );
            }
            if let Some(url) = check.url {
                card = card.child(
                    Button::new(SharedString::from(format!("check-link-{index}")))
                        .ghost()
                        .label("Open check")
                        .on_click(move |_, _, cx| {
                            if url::Url::parse(&url)
                                .is_ok_and(|url| matches!(url.scheme(), "http" | "https"))
                            {
                                cx.open_url(&url);
                            }
                        }),
                );
            }
            root = root.child(card);
        }
        root = root.child(Self::header(
            "Files",
            "Review the provider's patch at the captured pull request revision.",
        ));
        for file in detail.files {
            let mut card = div()
                .p_3()
                .border_1()
                .border_color(cx.theme().border)
                .rounded_md()
                .flex()
                .flex_col()
                .gap_2()
                .child(format!(
                    "{} · {} · +{} −{}",
                    file.path,
                    file.status,
                    file.additions.unwrap_or(0),
                    file.deletions.unwrap_or(0)
                ));
            if let Some(patch) = file.patch {
                let old = if file.status == "added" {
                    "/dev/null"
                } else {
                    "a/file"
                };
                let new = if file.status == "removed" {
                    "/dev/null"
                } else {
                    "b/file"
                };
                let patch = format!("--- {old}\n+++ {new}\n{patch}\n");
                card = card.child(self.patch_diff(
                    &format!("pull:{repository}:{number}:{}", file.path),
                    &file.path,
                    &patch,
                    cx,
                ));
            } else {
                card = card.child("No text patch is available for this file.");
            }
            card = card.child(self.pull_inline_form(
                &repository,
                &detail.pull,
                &file.path,
                &capabilities,
                window,
                cx,
            ));
            root = root.child(card);
        }
        root = root.child(Self::header(
            "Discussion",
            "Comments and reviews from the connected forge.",
        ));
        for comment in detail.comments {
            let mut card = div()
                .p_3()
                .border_1()
                .border_color(cx.theme().border)
                .rounded_md()
                .flex()
                .flex_col()
                .gap_2()
                .child(format!(
                    "{} · {}{}",
                    comment.author,
                    comment.date,
                    comment
                        .state
                        .as_ref()
                        .map(|state| format!(" · {state}"))
                        .unwrap_or_default()
                ));
            if let Some(path) = &comment.path {
                card = card.child(format!(
                    "{path}{}",
                    comment
                        .line
                        .map_or_else(String::new, |line| format!(":{line}"))
                ));
                if let Some(diff) = &comment.diff {
                    card = card.child(self.patch_diff(
                        &format!("pull-inline-context:{}", comment.id),
                        path,
                        &format!("--- a/file\n+++ b/file\n{diff}\n"),
                        cx,
                    ));
                }
            }
            if comment.outdated == Some(true) {
                card = card.child("Outdated · this discussion refers to an earlier revision");
            }
            if let Some(commit) = &comment.commit_id {
                card = card.child(format!("Revision: {commit}"));
            }
            let url = comment.url.clone();
            card = card.child(
                Button::new(SharedString::from(format!(
                    "pull-comment-link:{}",
                    comment.id
                )))
                .ghost()
                .label("Open discussion on forge")
                .on_click(move |_, _, cx| {
                    if url::Url::parse(&url)
                        .is_ok_and(|url| matches!(url.scheme(), "http" | "https"))
                    {
                        cx.open_url(&url);
                    }
                }),
            );
            card = card.child(self.pull_comment_actions(
                &repository,
                &detail.pull,
                &comment,
                &capabilities,
                window,
                cx,
            ));
            root = root.child(
                card.child(
                    TextView::markdown(
                        SharedString::from(format!("pull-comment-{}", comment.id)),
                        comment.body,
                    )
                    .selectable(true),
                ),
            );
        }
        root = root.child(Self::header(
            "Work on this pull request",
            "Create a draft agent task tied to this revision.",
        ));
        let objective_key = format!("pull-objective:{repository}:{number}");
        root = root.child(self.text_field(
            &objective_key,
            "Objective",
            "",
            "What should the agent review or change?",
            window,
            cx,
        ));
        let agents = match self.task_agent_options() {
            Ok(agents) => agents,
            Err(error) => return root.child(error.to_string()).into_any_element(),
        };
        root = root.child(
            div()
                .flex()
                .flex_wrap()
                .gap_2()
                .children(agents.into_iter().map(|agent| {
                    let id = agent.id;
                    Button::new(SharedString::from(format!("pull-agent-{id}")))
                        .label(agent.name)
                        .selected(self.selected_agent.as_ref() == Some(&id))
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.selected_agent = Some(id.clone());
                            cx.notify();
                        }))
                })),
        );
        root = root.child(
            Button::new("pull-use-default-agent")
                .label("Use task defaults")
                .selected(self.selected_agent.is_none())
                .on_click(cx.listener(|this, _, _, cx| {
                    this.selected_agent = None;
                    cx.notify();
                })),
        );
        let checkout_key = format!("pull-checkout:{repository}:{number}");
        root = root
            .child(self.field(
                &checkout_key,
                "Checkout",
                "new-branch",
                "Separate task branch or PR branch",
                window,
                cx,
            ))
            .child(self.work_field_choices(
                &checkout_key,
                &if detail.pull.head_clone_url.is_some() {
                    vec!["new-branch".into(), "pr-branch".into()]
                } else {
                    vec!["new-branch".into()]
                },
                cx,
            ));
        root.child(
            Button::new("pull-create-task")
                .primary()
                .label("Create task")
                .disabled(
                    !self.online
                        || self
                            .pending
                            .contains(&format!("pull-task:{repository}:{number}")),
                )
                .on_click(cx.listener(move |this, _, _, cx| {
                    let objective = this.text_value(&objective_key, cx);
                    if objective.trim().is_empty() {
                        this.error = Some("Enter an objective".into());
                    } else {
                        let mode = this.value(&checkout_key, cx);
                        this.create_pull_task(
                            &repository,
                            &detail.pull,
                            &objective,
                            &mode,
                            false,
                            cx,
                        );
                    }
                    cx.notify();
                })),
        )
        .into_any_element()
    }
    fn create_pull_task(
        &mut self,
        repository: &str,
        pull: &crate::model::PullInfo,
        objective: &str,
        mode: &str,
        stack: bool,
        cx: &mut Context<Self>,
    ) {
        let result = (|| -> anyhow::Result<Value> {
            anyhow::ensure!(
                matches!(mode, "new-branch" | "pr-branch"),
                "Choose a separate task branch or the PR branch"
            );
            anyhow::ensure!(
                mode != "pr-branch" || pull.head_clone_url.is_some(),
                "The PR source repository is unavailable. Choose a separate task branch."
            );
            let mut input = json!({"repositoryId":repository,"number":pull.number,"headSha":pull.head_sha,"objective":objective,"checkoutMode":mode,"run":false});
            if let Some(id) = &self.selected_agent {
                let agents = self.task_agent_options()?;
                let agent = agents.iter().find(|agent| &agent.id == id).ok_or_else(|| {
                    anyhow::anyhow!("The chosen agent configuration is no longer available")
                })?;
                input["harness"] = harness::freeze_agent(agent)?;
            }
            if stack {
                input["stackAction"] = json!("update");
            }
            Ok(input)
        })();
        match result {
            Ok(input) => self.request(
                format!("pull-task:{repository}:{}", pull.number),
                "/api/scm/pulls/task",
                input,
            ),
            Err(error) => self.error = Some(error.to_string()),
        }
        cx.notify();
    }
}
