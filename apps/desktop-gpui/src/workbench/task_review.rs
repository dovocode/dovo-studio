use super::*;
use crate::outbox::SavedMessage;
use serde::Deserialize;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Report {
    reviews: Vec<Review>,
    commands: Vec<Evidence>,
    current: bool,
    evidence_limited: bool,
    approved: bool,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Review {
    id: String,
    reviewer: String,
    reviewer_task_id: Option<String>,
    model: String,
    status: ReviewStatus,
    created_at: String,
    scope: Option<String>,
    summary: String,
    not_verified: Vec<String>,
    error: Option<String>,
    findings: Vec<Finding>,
}
#[derive(Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum ReviewStatus {
    Running,
    Completed,
    Failed,
    Cancelled,
}
impl ReviewStatus {
    fn label(self) -> &'static str {
        match self {
            Self::Running => "Running",
            Self::Completed => "Completed",
            Self::Failed => "Failed",
            Self::Cancelled => "Stopped",
        }
    }
}
#[derive(Clone, Deserialize)]
struct Finding {
    id: String,
    path: String,
    line: u64,
    severity: String,
    title: String,
    trigger: String,
    impact: String,
    suggestion: String,
    status: FindingStatus,
    resolution: Option<String>,
}
#[derive(Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum FindingStatus {
    Open,
    Addressed,
    Resolved,
    Dismissed,
}
impl FindingStatus {
    fn label(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Addressed => "addressed",
            Self::Resolved => "resolved",
            Self::Dismissed => "dismissed",
        }
    }
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Evidence {
    id: String,
    command: String,
    output: String,
    time: String,
    source: String,
    status: String,
    exit_code: Option<i32>,
    revision: Option<String>,
}
#[derive(Default)]
pub(super) struct ReviewState {
    current_key: String,
    report: Option<Report>,
    error: Option<String>,
    last_read: Option<std::time::Instant>,
}
impl ReviewState {
    fn receive(&mut self, key: &str, result: Result<Value, String>) {
        if self.current_key != key {
            return;
        }
        match result.and_then(|value| {
            serde_json::from_value(value).map_err(|error| format!("Invalid review report: {error}"))
        }) {
            Ok(report) => {
                self.report = Some(report);
                self.error = None;
            }
            Err(error) => self.error = Some(error),
        }
    }
}
impl Workbench {
    pub(super) fn refresh_task_review(&mut self, id: &str) {
        if !self.online
            || !self
                .snapshot
                .as_ref()
                .is_some_and(|s| s.extra.get("codeReviewsEnabled") == Some(&json!(true)))
        {
            return;
        }
        let prefix = format!("task-review:{id}:");
        if self.pending.iter().any(|key| key.starts_with(&prefix))
            || self
                .review_deliveries
                .keys()
                .any(|key| key.starts_with(&prefix))
        {
            return;
        }
        let state = self.task_reviews.entry(id.into()).or_default();
        let interval = if state
            .report
            .as_ref()
            .and_then(|r| r.reviews.first())
            .is_some_and(|r| r.status == ReviewStatus::Running)
        {
            2
        } else {
            15
        };
        if state
            .last_read
            .is_some_and(|last| last.elapsed().as_secs() < interval)
        {
            return;
        }
        state.last_read = Some(std::time::Instant::now());
        self.task_review_request(id, "read", json!({}));
    }
    fn task_review_request(&mut self, id: &str, action: &str, mut input: Value) {
        input["taskId"] = json!(id);
        let key = format!("task-review:{id}:{action}:{}", uuid::Uuid::new_v4());
        if action == "start" || action == "fix" {
            input[if action == "start" {
                "requestId"
            } else {
                "messageId"
            }] = json!(uuid::Uuid::new_v4());
            self.review_deliveries.insert(
                key.clone(),
                SavedMessage {
                    key: key.clone(),
                    path: format!("/api/review/task/{action}"),
                    input: input.clone(),
                },
            );
        }
        self.task_reviews.entry(id.into()).or_default().current_key = key.clone();
        self.request(key, &format!("/api/review/task/{action}"), input);
    }
    pub(super) fn receive_task_review(&mut self, key: &str, result: Result<Value, String>) {
        let Some(id) = key
            .strip_prefix("task-review:")
            .and_then(|key| key.split(':').next())
        else {
            return;
        };
        if result.is_ok() {
            self.review_deliveries.remove(key);
        }
        let state = self.task_reviews.entry(id.into()).or_default();
        if result
            .as_ref()
            .is_ok_and(|value| value.get("discarded") == Some(&json!(true)))
        {
            state.last_read = None;
            return;
        }
        state.receive(key, result);
    }
    pub(super) fn task_review_page(
        &mut self,
        task: &Task,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let enabled = self
            .snapshot
            .as_ref()
            .is_some_and(|s| s.extra.get("codeReviewsEnabled") == Some(&json!(true)));
        let mut root = div()
            .id("task-code-review")
            .flex_1()
            .min_h_0()
            .overflow_y_scroll()
            .p_4()
            .flex()
            .flex_col()
            .gap_3()
            .child(Self::header(
                "Independent code review",
                "Review findings, command evidence and approval of the current changes.",
            ));
        if !enabled {
            return root.child("Enable experimental code reviews in this computer’s settings to use this view.").into_any_element();
        }
        let prefix = format!("task-review:{}:", task.id);
        let busy = self.pending.iter().any(|key| key.starts_with(&prefix));
        let uncertain: Vec<_> = self
            .review_deliveries
            .values()
            .filter(|message| message.key.starts_with(&prefix))
            .cloned()
            .collect();
        for saved in &uncertain {
            let id = task.id.clone();
            let retry = saved.key.clone();
            let discard = retry.clone();
            root=root.child(div().p_3().bg(cx.theme().warning.opacity(0.15)).child("A review request needs its receipt checked. Retrying keeps the original request and input.")
                .child(Button::new(SharedString::from(format!("retry-{}",saved.key))).label("Check receipt / retry").disabled(!self.online||busy).on_click(cx.listener(move|this,_,_,cx| {
                    this.task_reviews.entry(id.clone()).or_default().current_key=retry.clone();this.pending.insert(retry.clone());this.command(Command::RetryMessage(retry.clone()));cx.notify();
                })))
                .child(Button::new(SharedString::from(format!("discard-{}",saved.key))).label("Discard saved retry").disabled(busy).on_click(cx.listener(move|this,_,_,cx|{this.pending.insert(discard.clone());this.command(Command::DiscardMessage(discard.clone()));cx.notify();}))));
        }
        let disabled = !self.online || busy || !uncertain.is_empty();
        let refresh = task.id.clone();
        root = root.child(
            Button::new("refresh-task-review")
                .label("Refresh report")
                .disabled(disabled)
                .on_click(cx.listener(move |this, _, _, cx| {
                    this.task_reviews
                        .entry(refresh.clone())
                        .or_default()
                        .last_read = None;
                    this.refresh_task_review(&refresh);
                    cx.notify();
                })),
        );
        let reviewer_key = format!("reviewer-agent:{}", task.id);
        self.input(&reviewer_key, "", "", window, cx);
        let mut reviewers = div().flex().flex_wrap().gap_2();
        for (id, name) in
            std::iter::once((String::new(), "Thread model · fresh session".to_owned())).chain(
                self.snapshot
                    .as_ref()
                    .into_iter()
                    .flat_map(|s| s.workspace.agents.iter())
                    .filter(|agent| {
                        !matches!(
                            agent.provider,
                            crate::model::Provider::Hermes
                                | crate::model::Provider::Grok
                                | crate::model::Provider::Muse
                        )
                    })
                    .map(|agent| (agent.id.clone(), agent.name.clone())),
            )
        {
            let key = reviewer_key.clone();
            let selected = self.value(&key, cx) == id;
            reviewers = reviewers.child(
                Button::new(SharedString::from(format!("reviewer-choice-{id}")))
                    .label(name)
                    .selected(selected)
                    .disabled(disabled)
                    .on_click(cx.listener(move |this, _, window, cx| {
                        if let Some(input) = this.inputs.get(&key) {
                            input.update(cx, |input, cx| input.set_value(id.clone(), window, cx));
                        }
                        cx.notify();
                    })),
            );
        }
        root = root.child(reviewers);
        let review_running = self
            .task_reviews
            .get(&task.id)
            .and_then(|s| s.report.as_ref())
            .is_some_and(|r| r.reviews.iter().any(|r| r.status == ReviewStatus::Running));
        for (scope, label) in [
            ("working", "Review working changes"),
            ("branch", "Review branch changes"),
        ] {
            let id = task.id.clone();
            root = root.child(
                Button::new(scope)
                    .label(label)
                    .disabled(disabled || task.status == TaskStatus::Running || review_running)
                    .on_click(cx.listener(move |this, _, _, cx| {
                        let mut input = json!({"scope":scope});
                        let reviewer = this.value(&format!("reviewer-agent:{id}"), cx);
                        if !reviewer.is_empty() {
                            input["agentId"] = json!(reviewer);
                        }
                        this.task_review_request(&id, "start", input);
                        cx.notify();
                    })),
            );
        }
        let state = self.task_reviews.get(&task.id);
        if let Some(error) = state.and_then(|state| state.error.clone()) {
            root = root.child(div().text_color(cx.theme().danger).child(error));
        }
        let Some(report) = state.and_then(|state| state.report.clone()) else {
            return root.child("Loading review report…").into_any_element();
        };
        root = root.child(format!(
            "{} · {}",
            if report.reviews.is_empty() {
                "No independent reviews yet"
            } else if report.current {
                "Current changes"
            } else {
                "Changes have moved since review"
            },
            if report.approved {
                "Approved"
            } else {
                "Approval pending"
            }
        ));
        if report.evidence_limited {
            root = root
                .child("Command evidence is incomplete. The runtime retains a limited history.");
        }
        for (index, review) in report.reviews.iter().enumerate() {
            let mut card = div()
                .border_1()
                .border_color(cx.theme().border)
                .rounded_md()
                .p_3()
                .flex()
                .flex_col()
                .gap_2()
                .child(format!(
                    "{} · {} · {} · {} · {}",
                    review.reviewer,
                    review.model,
                    review.status.label(),
                    review.scope.as_deref().unwrap_or("working"),
                    review.created_at
                ))
                .child(
                    TextView::markdown(
                        SharedString::from(format!("review-summary-{}", review.id)),
                        review.summary.clone(),
                    )
                    .selectable(true),
                );
            if let Some(error) = &review.error {
                card = card.child(error.clone());
            }
            for missing in &review.not_verified {
                card = card.child(format!("Not verified: {missing}"));
            }
            if let Some(reviewer) = &review.reviewer_task_id {
                let reviewer = reviewer.clone();
                card = card.child(
                    Button::new(SharedString::from(format!("open-reviewer-{}", review.id)))
                        .label("Open reviewer thread")
                        .on_click(cx.listener(move |this, _, window, cx| {
                            this.select_task(reviewer.clone(), window, cx)
                        })),
                );
            }
            let current = index == 0 && report.current && review.status == ReviewStatus::Completed;
            if review.status == ReviewStatus::Running {
                let id = task.id.clone();
                let review_id = review.id.clone();
                card = card.child(
                    Button::new(SharedString::from(format!("stop-review-{}", review.id)))
                        .label("Stop review")
                        .disabled(disabled)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.task_review_request(&id, "stop", json!({"reviewId":review_id}));
                            cx.notify();
                        })),
                );
            }
            if index == 0 && review.status == ReviewStatus::Completed {
                let can_approve = current
                    && !review.findings.iter().any(|f| {
                        matches!(f.status, FindingStatus::Open | FindingStatus::Addressed)
                    });
                let id = task.id.clone();
                let review_id = review.id.clone();
                let approved = report.approved;
                card = card.child(
                    Button::new(SharedString::from(format!("approve-review-{}", review.id)))
                        .label(if approved {
                            "Revoke approval"
                        } else {
                            "Approve current changes"
                        })
                        .disabled(disabled || (!approved && !can_approve))
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.task_review_request(
                                &id,
                                "approve",
                                json!({"reviewId":review_id,"approved":!approved}),
                            );
                            cx.notify();
                        })),
                );
            }
            let delta_key = format!("review-delta:{}:{}", task.id, review.id);
            let request_key = delta_key.clone();
            let id = task.id.clone();
            let review_id = review.id.clone();
            card = card.child(
                Button::new(SharedString::from(format!("review-changes-{}", review.id)))
                    .label("Changes since this review")
                    .disabled(!self.online || self.pending.contains(&delta_key))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.request(
                            request_key.clone(),
                            "/api/review/task/changes",
                            json!({"taskId":id,"reviewId":review_id}),
                        );
                        cx.notify();
                    })),
            );
            if let Some(value) = self.responses.get(&delta_key).cloned() {
                match serde_json::from_value::<Vec<crate::model::ChangedFile>>(
                    value.get("files").cloned().unwrap_or(Value::Null),
                ) {
                    Ok(files) => {
                        let selection = format!("{delta_key}:selection");
                        let selected = self
                            .responses
                            .get(&selection)
                            .and_then(Value::as_str)
                            .or_else(|| files.first().map(|file| file.path.as_str()));
                        let file = files
                            .iter()
                            .find(|file| Some(file.path.as_str()) == selected)
                            .cloned();
                        if files.is_empty() {
                            card = card.child("No changes since this review.");
                        }
                        let mut choices = div().flex().flex_wrap().gap_2();
                        for file in &files {
                            let selection = selection.clone();
                            let path = file.path.clone();
                            choices =
                                choices.child(
                                    Button::new(SharedString::from(format!(
                                        "{delta_key}:{}",
                                        file.path
                                    )))
                                    .label(file.path.clone())
                                    .selected(selected == Some(file.path.as_str()))
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        this.responses.insert(selection.clone(), json!(path));
                                        cx.notify();
                                    })),
                                );
                        }
                        card = card.child(choices);
                        if let Some(file) = file {
                            card = card.child(div().h(px(360.)).child(self.changed_file_diff(
                                &format!("{delta_key}:{}", file.path),
                                &file.path,
                                &file.before,
                                &file.after,
                                cx,
                            )));
                        }
                    }
                    Err(error) => card = card.child(format!("Invalid review changes: {error}")),
                }
            }
            for finding in &review.findings {
                let mut row = div()
                    .p_3()
                    .border_t_1()
                    .border_color(cx.theme().border)
                    .child(format!(
                        "{} · {}:{} · {} · {}",
                        finding.severity,
                        finding.path,
                        finding.line,
                        finding.title,
                        finding.status.label()
                    ))
                    .child(
                        TextView::markdown(
                            SharedString::from(format!("finding-{}", finding.id)),
                            format!(
                                "**Trigger:** {}\n\n**Impact:** {}\n\n**Suggested fix:** {}",
                                finding.trigger, finding.impact, finding.suggestion
                            ),
                        )
                        .selectable(true),
                    );
                let form_key = format!(
                    "finding-resolution:{}:{}:{}",
                    task.id, review.id, finding.id
                );
                let resolution = self.input(
                    &form_key,
                    finding.resolution.as_deref().unwrap_or(""),
                    "Resolution or dismissal reason",
                    window,
                    cx,
                );
                row = row.child(Input::new(&resolution));
                let mut actions = div().flex().flex_wrap().gap_2();
                for (status, label) in [
                    ("open", "Reopen"),
                    ("addressed", "Mark addressed"),
                    ("resolved", "Resolve"),
                    ("dismissed", "Dismiss"),
                ] {
                    let id = task.id.clone();
                    let review_id = review.id.clone();
                    let finding_id = finding.id.clone();
                    let form = form_key.clone();
                    actions=actions.child(Button::new(SharedString::from(format!("{}-{status}",finding.id))).label(label).disabled(disabled||index!=0||review.status!=ReviewStatus::Completed||finding.status.label()==status).on_click(cx.listener(move|this,_,_,cx|{
                        let mut input=json!({"reviewId":review_id,"findingId":finding_id,"status":status});let reason=this.value(&form,cx);if !reason.is_empty(){input["resolution"]=json!(reason);}this.task_review_request(&id,"finding",input);cx.notify();
                    })));
                }
                let id = task.id.clone();
                let review_id = review.id.clone();
                let finding_id = finding.id.clone();
                actions = actions.child(
                    Button::new(SharedString::from(format!("fix-{}", finding.id)))
                        .label("Ask author to fix")
                        .disabled(disabled || !current || task.status == TaskStatus::Running)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.task_review_request(
                                &id,
                                "fix",
                                json!({"reviewId":review_id,"findingIds":[finding_id]}),
                            );
                            cx.notify();
                        })),
                );
                card = card.child(row.child(actions));
            }
            root = root.child(card);
        }
        root = root.child(
            div()
                .font_weight(FontWeight::SEMIBOLD)
                .child("Command evidence"),
        );
        for command in &report.commands {
            root = root.child(
                div()
                    .p_3()
                    .border_1()
                    .border_color(cx.theme().border)
                    .child(format!(
                        "{} · {} · {} · exit {} · {}",
                        command.status,
                        command.source,
                        command.time,
                        command
                            .exit_code
                            .map(|code| code.to_string())
                            .unwrap_or_else(|| "unknown".into()),
                        command
                            .revision
                            .as_deref()
                            .unwrap_or("unattributed revision")
                    ))
                    .child(
                        TextView::markdown(
                            SharedString::from(format!("command-evidence-{}", command.id)),
                            format!("{}\n\n{}", command.command, command.output),
                        )
                        .selectable(true),
                    ),
            );
        }
        root.into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    #[test]
    fn late_reads_cannot_overwrite_an_action_report() {
        let mut state = ReviewState {
            current_key: "action".into(),
            ..Default::default()
        };
        let report = json!({"reviews":[],"commands":[],"current":true,"evidenceLimited":false,"approved":true});
        state.receive("action", Ok(report.clone()));
        state.receive("old-read", Err("Obsolete failure".into()));
        let mut stale = report;
        stale["approved"] = json!(false);
        state.receive("old-read", Ok(stale));
        assert!(state.report.unwrap().approved);
        assert!(state.error.is_none());
    }
}
