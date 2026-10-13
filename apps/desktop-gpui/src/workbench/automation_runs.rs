use super::*;
use crate::model::{Automation, JobRun};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunStep {
    node_id: String,
    label: String,
    kind: String,
    status: String,
    task_id: Option<String>,
    attempt: u64,
    error: Option<String>,
    started_at: Option<String>,
    finished_at: Option<String>,
}

fn active(run: &JobRun) -> bool {
    matches!(run.status.as_str(), "running" | "waiting")
}
fn run_steps(run: &JobRun, flow: &Automation) -> anyhow::Result<Vec<RunStep>> {
    if let Some(steps) = run.extra.get("steps") {
        return Ok(serde_json::from_value(steps.clone())?);
    }
    #[derive(Deserialize)]
    struct Node {
        id: String,
        data: Data,
    }
    #[derive(Deserialize)]
    struct Data {
        label: String,
        kind: String,
    }
    let nodes: Vec<Node> =
        serde_json::from_value(flow.extra.get("nodes").cloned().unwrap_or(json!([])))?;
    let completed: Vec<String> = serde_json::from_value(
        run.extra
            .get("completedNodes")
            .cloned()
            .unwrap_or(json!([])),
    )?;
    Ok(nodes
        .into_iter()
        .map(|node| {
            let status = if completed.contains(&node.id) {
                "completed"
            } else if run.extra.get("waitingNodeId").and_then(Value::as_str) == Some(&node.id) {
                "waiting"
            } else if run.extra.get("failedNodeId").and_then(Value::as_str) == Some(&node.id) {
                "failed"
            } else if run.extra.get("currentNodeId").and_then(Value::as_str) == Some(&node.id) {
                "running"
            } else {
                "pending"
            };
            RunStep {
                node_id: node.id,
                label: node.data.label,
                kind: node.data.kind,
                status: status.into(),
                attempt: 1,
                task_id: None,
                error: None,
                started_at: None,
                finished_at: None,
            }
        })
        .collect())
}
impl Workbench {
    pub(super) fn automation_run_button(&self, id: &str, cx: &mut Context<Self>) -> AnyElement {
        let pending = self.automation_starts.contains_key(id);
        let live = self.snapshot.as_ref().is_some_and(|snapshot| {
            snapshot
                .runs
                .iter()
                .any(|run| run.automation_id == id && active(run))
        });
        let id = id.to_owned();
        Button::new(SharedString::from(format!("run-{id}")))
            .primary()
            .label(if pending { "Retry start" } else { "Run" })
            .disabled(
                !self.online || self.pending.contains(&format!("job-run:{id}")) || live && !pending,
            )
            .on_click(cx.listener(move |this, _, _, cx| {
                let request_id = this
                    .automation_starts
                    .entry(id.clone())
                    .or_insert_with(|| uuid::Uuid::new_v4().to_string())
                    .clone();
                this.request(
                    format!("job-run:{id}"),
                    "/api/jobs/run",
                    json!({"id":id,"requestId":request_id}),
                );
                cx.notify();
            }))
            .into_any_element()
    }
    pub(super) fn receive_automation_action(&mut self, key: &str, result: &Value) {
        if let Some(flow) = key.strip_prefix("job-run:") {
            self.automation_starts.remove(flow);
            if let Some(id) = result.get("id").and_then(Value::as_str) {
                self.responses
                    .insert(format!("selected-run:{flow}"), json!(id));
            }
        }
        if let Some(run_id) = key.strip_prefix("job:")
            && let Some(run) = self
                .snapshot
                .as_ref()
                .and_then(|snapshot| snapshot.runs.iter().find(|run| run.id == run_id))
            && let Some(id) = result.get("id").and_then(Value::as_str)
        {
            self.responses
                .insert(format!("selected-run:{}", run.automation_id), json!(id));
        }
    }
    pub(super) fn automation_run_details(
        &mut self,
        flow: &Automation,
        all_runs: &[JobRun],
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let mut runs: Vec<_> = all_runs
            .iter()
            .filter(|run| run.automation_id == flow.id)
            .collect();
        runs.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        if runs.is_empty() {
            return div().into_any_element();
        }
        let selected = self
            .responses
            .get(&format!("selected-run:{}", flow.id))
            .and_then(Value::as_str);
        let run = runs
            .iter()
            .find(|run| Some(run.id.as_str()) == selected)
            .copied()
            .unwrap_or(runs[0]);
        let mut root = div()
            .flex()
            .flex_col()
            .gap_3()
            .p_4()
            .rounded_md()
            .border_1()
            .border_color(cx.theme().border)
            .child(Self::header(
                &format!("{} · run history", flow.name),
                "Each run retains its original steps and task results.",
            ));
        let mut choices = div().flex().flex_wrap().gap_2();
        for item in &runs {
            let id = item.id.clone();
            let flow_id = flow.id.clone();
            choices = choices.child(
                Button::new(SharedString::from(format!("select-run:{id}")))
                    .label(format!("{} · {}", item.created_at, item.status))
                    .selected(item.id == run.id)
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.responses
                            .insert(format!("selected-run:{flow_id}"), json!(id));
                        cx.notify();
                    })),
            );
        }
        root = root.child(choices).child(format!(
            "{} · attempt {}",
            run.status,
            run.extra
                .get("attempt")
                .and_then(Value::as_u64)
                .unwrap_or(1)
        ));
        if run.extra.get("interrupted").and_then(Value::as_bool) == Some(true) {
            root=root.child("The runtime stopped before this run finished. Retry resumes from the interrupted step.");
        }
        if let Some(error) = &run.error {
            root = root.child(error.clone());
        }
        let another = runs.iter().any(|other| other.id != run.id && active(other));
        let actions: Vec<_> = match run.status.as_str() {
            "waiting" => vec![
                (
                    "Approve review",
                    "/api/jobs/review",
                    json!({"id":run.id,"allow":true}),
                ),
                (
                    "Reject review",
                    "/api/jobs/review",
                    json!({"id":run.id,"allow":false}),
                ),
                ("Cancel run", "/api/jobs/cancel", json!({"id":run.id})),
            ],
            "running" => vec![("Cancel run", "/api/jobs/cancel", json!({"id":run.id}))],
            "failed" | "cancelled" => {
                vec![("Retry failed step", "/api/jobs/retry", json!({"id":run.id}))]
            }
            _ => vec![],
        };
        root = root.child(
            div()
                .flex()
                .flex_wrap()
                .gap_2()
                .children(actions.into_iter().map(|(label, path, input)| {
                    let key = format!("job:{}", run.id);
                    Button::new(SharedString::from(format!("{key}:{label}")))
                        .label(label)
                        .disabled(!self.online || self.pending.contains(&key) || another)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.request(key.clone(), path, input.clone());
                            cx.notify();
                        }))
                })),
        );
        match run_steps(run, flow) {
            Ok(steps) => {
                let completed = steps
                    .iter()
                    .filter(|step| step.status == "completed")
                    .count();
                root = root.child(format!("{completed}/{} steps completed", steps.len()));
                for step in steps {
                    let input = self.snapshot.as_ref().and_then(|snapshot| {
                        snapshot
                            .approvals
                            .iter()
                            .find(|approval| {
                                Some(approval.task_id.as_str()) == step.task_id.as_deref()
                            })
                            .map(|approval| approval.title.clone())
                            .or_else(|| {
                                snapshot
                                    .questions
                                    .iter()
                                    .find(|question| {
                                        Some(question.task_id.as_str()) == step.task_id.as_deref()
                                    })
                                    .map(|question| question.prompt.title.clone())
                            })
                    });
                    let mut row = div()
                        .flex()
                        .flex_col()
                        .gap_2()
                        .p_3()
                        .bg(cx.theme().muted)
                        .rounded_md()
                        .child(format!(
                            "{} · {} · {} · attempt {}",
                            step.label,
                            step.kind,
                            if input.is_some() {
                                "Needs input"
                            } else {
                                &step.status
                            },
                            step.attempt
                        ));
                    if let Some(input) = input {
                        row = row.child(input);
                    }
                    if let Some(error) = step.error {
                        row = row.child(error);
                    }
                    if let Some(started) = step.started_at {
                        row = row.child(format!("Started {started}"));
                    }
                    if let Some(finished) = step.finished_at {
                        row = row.child(format!("Finished {finished}"));
                    }
                    if let Some(task_id) = step.task_id {
                        row = row.child(
                            Button::new(SharedString::from(format!(
                                "run-task:{}:{}",
                                run.id, step.node_id
                            )))
                            .label("Open task")
                            .on_click(cx.listener(
                                move |this, _, window, cx| {
                                    this.select_task(task_id.clone(), window, cx)
                                },
                            )),
                        );
                    }
                    root = root.child(row);
                }
            }
            Err(error) => root = root.child(format!("Invalid run steps: {error}")),
        }
        let _ = window;
        root.into_any_element()
    }
}

impl Workbench {
    pub(super) fn automation_webhook(&mut self, id: &str, cx: &mut Context<Self>) -> AnyElement {
        let key = format!("webhook:{id}");
        let request_key = key.clone();
        let flow_id = id.to_owned();
        let owner = self.snapshot.as_ref().is_some_and(|s| s.owner);
        let mut root=div().flex().flex_col().gap_3().child(Self::header("Webhook","Send JSON with the credential in the Authorization: Bearer header. The runtime must be running."))
            .child(Button::new(SharedString::from(format!("{key}:rotate"))).label("Create or rotate webhook credential…").disabled(!self.online||!owner||self.pending.contains(&key)).on_click(cx.listener(move|this,_,window,cx|{
                let generation=this.generation;let key=request_key.clone();let id=flow_id.clone();
                let prompt=window.prompt(PromptLevel::Warning,"Rotate webhook credential?",Some("Any previously issued credential stops working. The new credential is shown once here; save it in the service that sends deliveries."),&["Keep credential","Rotate"],cx);
                cx.spawn(async move|this,cx|{if prompt.await==Ok(1){let _=this.update(cx,|this,cx|{if this.generation==generation{this.request(key,"/api/jobs/webhook-secret",json!({"id":id}));cx.notify();}});}}).detach();
            })));
        if !owner {
            root = root.child("Webhook credentials can be rotated only by the runtime owner.");
        }
        if let Some(credential) = self.responses.get(&key) {
            let path = credential
                .get("path")
                .and_then(Value::as_str)
                .unwrap_or_default();
            let address = self.address.trim_end_matches('/');
            let url = format!("{address}{path}");
            let secret = credential
                .get("secret")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned();
            let header = format!("Authorization: Bearer {secret}");
            let dismiss_key = key.clone();
            root=root.child(url.clone()).child("Credential received. Copy it before hiding this panel; it cannot be read again.")
                .child(Button::new("copy-webhook-url").label("Copy webhook URL").on_click(cx.listener(move|_,_,_,cx|cx.write_to_clipboard(ClipboardItem::new_string(url.clone())))))
                .child(Button::new("copy-webhook-secret").label("Copy Authorization header").on_click(cx.listener(move|_,_,_,cx|cx.write_to_clipboard(ClipboardItem::new_string(header.clone())))))
                .child(Button::new("hide-webhook-secret").ghost().label("Hide credential").on_click(cx.listener(move|this,_,_,cx|{this.responses.remove(&dismiss_key);cx.notify();})));
        }
        root.into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    #[test]
    fn historical_steps_survive_edits_to_the_current_workflow() {
        let flow:Automation=serde_json::from_value(json!({"id":"flow","name":"Edited flow","nodes":[{"id":"new-task","data":{"label":"Changed task","kind":"task"}}]})).unwrap();
        let run:JobRun=serde_json::from_value(json!({"id":"run","automationId":"flow","status":"failed","createdAt":"now","steps":[{"nodeId":"old-task","label":"Original task","kind":"task","status":"failed","taskId":"original-task","attempt":2,"error":"Provider disconnected"}]})).unwrap();
        let steps = run_steps(&run, &flow).unwrap();
        assert_eq!(steps[0].node_id, "old-task");
        assert_eq!(steps[0].label, "Original task");
        assert_eq!(steps[0].task_id.as_deref(), Some("original-task"));
        assert_eq!(steps[0].attempt, 2);
    }
}
