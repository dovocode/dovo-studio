use crate::{
    connection::{Connection, RuntimeClient, public_post},
    model::{Snapshot, WorkspacePatch},
    sync::Replica,
};
use anyhow::{Context, Result, ensure};
use futures_util::{SinkExt, StreamExt};
use reqwest::Method;
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};
use tokio_tungstenite::{connect_async, tungstenite::Message};

struct TestRuntime {
    process: Child,
    directory: tempfile::TempDir,
    client: RuntimeClient,
}
impl Drop for TestRuntime {
    fn drop(&mut self) {
        #[cfg(unix)]
        {
            let _ = Command::new("kill")
                .args(["-TERM", &self.process.id().to_string()])
                .status();
        }
        #[cfg(windows)]
        {
            let _ = self.process.kill();
        }
        let _ = self.process.wait();
    }
}
impl TestRuntime {
    async fn start() -> Result<Self> {
        Self::start_entry("apps/api/dist/index.js").await
    }
    async fn start_entry(entry: &str) -> Result<Self> {
        let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
        let entry = root.join(entry);
        ensure!(
            entry.exists(),
            "Build the runtime first: pnpm --filter @dovo/api... -r build"
        );
        let directory = tempfile::tempdir()?;
        let output = std::fs::File::create(directory.path().join("runtime.log"))?;
        let mut process = Command::new("node")
            .arg(entry)
            .current_dir(&root)
            .env(
                "DOVO_DATABASE_PATH",
                directory.path().join("runtime.sqlite"),
            )
            .env("DOVO_SETTINGS_PATH", directory.path().join("settings.json"))
            .env("DOVO_DATA_ROOT", directory.path())
            .env("DOVO_HOST", "127.0.0.1")
            .env("PORT", "0")
            .env("DOVO_LOGIN_PATH", "off")
            .stdout(Stdio::from(output.try_clone()?))
            .stderr(Stdio::from(output))
            .spawn()?;
        let deadline = Instant::now() + Duration::from_secs(20);
        loop {
            if let Some(status) = process.try_wait()? {
                anyhow::bail!(
                    "Runtime exited ({status}): {}",
                    std::fs::read_to_string(directory.path().join("runtime.log"))?
                );
            }
            if let Ok(bytes) = std::fs::read(directory.path().join("runtime-connection.json")) {
                let connection: Connection = serde_json::from_slice(&bytes)?;
                let client = RuntimeClient::new(connection)?;
                return Ok(Self {
                    process,
                    directory,
                    client,
                });
            }
            if Instant::now() > deadline {
                process.kill()?;
                process.wait()?;
                anyhow::bail!(
                    "Runtime did not start: {}",
                    std::fs::read_to_string(directory.path().join("runtime.log"))?
                );
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    }
}

struct TestForge(Child);
impl Drop for TestForge {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

async fn wait_for_job(client: &RuntimeClient, id: &str, status: &str) -> Result<Snapshot> {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let snapshot: Snapshot = serde_json::from_value(client.snapshot(None).await?)?;
        if snapshot
            .runs
            .iter()
            .any(|run| run.id == id && run.status == status)
        {
            return Ok(snapshot);
        }
        ensure!(
            Instant::now() < deadline,
            "Job did not reach {status}; runs: {}",
            serde_json::to_string(&snapshot.runs)?
        );
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
}

#[tokio::test]
#[ignore = "Requires the compiled Node runtime; run pnpm test:gpui:integration"]
async fn native_automation_jobs_deduplicate_starts_and_preserve_retry_steps() -> Result<()> {
    let runtime = TestRuntime::start_entry("scripts/fixtures/gpui-task-revisions.mjs").await?;
    let client = &runtime.client;
    let initial: Snapshot = serde_json::from_value(client.snapshot(None).await?)?;
    let flow = initial
        .workspace
        .automations
        .iter()
        .find(|flow| flow.id == "flow")
        .context("Missing workflow")?;
    let before_nodes = flow.extra["nodes"].clone();
    let mut nodes = before_nodes.clone();
    let data = nodes
        .as_array_mut()
        .context("Invalid nodes")?
        .iter_mut()
        .find(|node| node["id"] == "task")
        .context("Missing task node")?
        .get_mut("data")
        .context("Missing node data")?;
    data["harness"] = json!({"provider":"codex","model":"frozen-automation","permission":"ask","endpoint":"","instructions":"Keep native settings","args":["--fixture"],"env":{"FIXTURE":"value=with=equals"}});
    data["execution"] = json!("worktree");
    data["linkedCheckouts"] = json!([{"id":"automation-link","repositoryId":"linked","execution":"main","access":"read-only"}]);
    let _:Value=client.request(Method::PATCH,"/api/workspace",Some(&json!({"collection":"automations","id":"flow","changes":{"nodes":{"before":before_nodes,"after":nodes}}}))).await?;
    ensure!(client.request::<Value>(Method::PATCH,"/api/workspace",Some(&json!({"collection":"automations","id":"flow","changes":{"nodes":{"before":before_nodes,"after":[]}}}))).await.is_err(),"Workflow stale save was accepted");
    let input = json!({"id":"flow","requestId":"native-stable-start"});
    let start: Value = client.post("/api/jobs/run", &input).await?;
    let id = start["id"].as_str().context("Missing run id")?;
    let waiting = wait_for_job(client, id, "waiting").await?;
    ensure!(
        waiting
            .runs
            .iter()
            .find(|run| run.id == id)
            .context("Missing waiting run")?
            .extra["waitingNodeId"]
            == "review",
        "Initial review gate missing"
    );
    let repeated: Value = client.post("/api/jobs/run", &input).await?;
    ensure!(
        repeated["id"] == start["id"],
        "Lost-response retry created another run"
    );
    let _: Value = client
        .post("/api/jobs/review", &json!({"id":id,"allow":true}))
        .await?;
    let failed = wait_for_job(client, id, "failed").await?;
    let run = failed
        .runs
        .iter()
        .find(|run| run.id == id)
        .context("Missing failed run")?;
    ensure!(
        run.error
            .as_deref()
            .is_some_and(|error| error.contains("Fixture provider disconnected")),
        "Failure detail missing"
    );
    let retry: Value = client.post("/api/jobs/retry", &json!({"id":id})).await?;
    ensure!(retry["id"] == start["id"], "Retry created another run");
    let final_review = wait_for_job(client, id, "waiting").await?;
    let run = final_review
        .runs
        .iter()
        .find(|run| run.id == id)
        .context("Missing retried run")?;
    ensure!(
        run.extra["waitingNodeId"] == "final"
            && run.extra["steps"]
                .as_array()
                .is_some_and(|steps| steps.iter().any(|step| step["nodeId"] == "task"
                    && step["attempt"] == 2
                    && step["status"] == "completed"
                    && step["taskId"].is_string())),
        "Retry did not preserve step progress and task links"
    );
    let automation_task_id = run.extra["steps"]
        .as_array()
        .and_then(|steps| steps.iter().find(|step| step["nodeId"] == "task"))
        .and_then(|step| step["taskId"].as_str())
        .context("Missing automation task")?;
    let automation_snapshot: Snapshot =
        serde_json::from_value(client.snapshot(Some(automation_task_id)).await?)?;
    let task = automation_snapshot
        .workspace
        .tasks
        .iter()
        .find(|task| task.id == automation_task_id)
        .context("Missing frozen task")?;
    ensure!(
        task.extra["harness"]["model"] == "frozen-automation"
            && task.extra["harness"]["env"]["FIXTURE"] == "value=with=equals"
            && task.extra["execution"] == "worktree"
            && task.extra["linkedCheckouts"][0]["access"] == "read-only",
        "Workflow launch settings were not frozen into the task"
    );
    let _: Value = client
        .post("/api/jobs/review", &json!({"id":id,"allow":true}))
        .await?;
    wait_for_job(client, id, "completed").await?;
    let repeated: Value = client.post("/api/jobs/run", &input).await?;
    ensure!(
        repeated["id"] == start["id"],
        "Completed request started twice"
    );
    let next: Value = client
        .post(
            "/api/jobs/run",
            &json!({"id":"flow","requestId":"next-native-start"}),
        )
        .await?;
    let next_id = next["id"].as_str().context("Missing next run")?;
    wait_for_job(client, next_id, "waiting").await?;
    let _: Value = client
        .post("/api/jobs/cancel", &json!({"id":next_id}))
        .await?;
    wait_for_job(client, next_id, "cancelled").await?;
    // Resume a genuine provider session: the saved-checkpoint task deliberately has a
    // synthetic fingerprint, so it cannot prove native compaction behavior.
    let task_id = run.extra["steps"]
        .as_array()
        .and_then(|steps| steps.iter().find(|step| step["nodeId"] == "task"))
        .and_then(|step| step["taskId"].as_str())
        .context("Missing completed automation task")?;
    let _: Value = client
        .post("/api/tasks/compact", &json!({"id":task_id}))
        .await?;
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        let snapshot: Snapshot = serde_json::from_value(client.snapshot(Some(task_id)).await?)?;
        if snapshot
            .workspace
            .tasks
            .iter()
            .find(|task| task.id == task_id)
            .is_some_and(|task| {
                task.status != crate::model::TaskStatus::Running
                    && task.extra.get("contextUsage").is_none()
                    && task
                        .extra
                        .get("compactions")
                        .and_then(Value::as_array)
                        .is_some_and(|items| {
                            items.iter().any(|item| {
                                item["provider"] == "codex"
                                    && item["trigger"] == "manual"
                                    && item["sessionId"] == "private-fixture-session"
                            })
                        })
            })
        {
            break;
        }
        ensure!(
            Instant::now() < deadline,
            "Native context compaction did not complete"
        );
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    // Exercise credentials against the webhook entrypoint without publishing them.
    let first: Value = client
        .post("/api/jobs/webhook-secret", &json!({"id":"flow"}))
        .await?;
    let second: Value = client
        .post("/api/jobs/webhook-secret", &json!({"id":"flow"}))
        .await?;
    let current: Snapshot = serde_json::from_value(client.snapshot(None).await?)?;
    let before = current
        .workspace
        .automations
        .iter()
        .find(|flow| flow.id == "flow")
        .context("Missing webhook flow")?;
    let mut webhook_nodes = before.extra["nodes"].clone();
    webhook_nodes
        .as_array_mut()
        .context("Missing trigger nodes")?
        .iter_mut()
        .find(|node| node["id"] == "trigger")
        .context("Missing trigger")?["data"]["trigger"] = json!("webhook");
    let _:Value=client.request(Method::PATCH,"/api/workspace",Some(&json!({"collection":"automations","id":"flow","changes":{"nodes":{"before":before.extra["nodes"],"after":webhook_nodes},"enabled":{"before":false,"after":true}}}))).await?;
    let http = reqwest::Client::new();
    let url = format!(
        "{}{}",
        client.connection.address,
        second["path"].as_str().context("Missing webhook path")?
    );
    let expired = http
        .post(&url)
        .bearer_auth(first["secret"].as_str().context("Missing first secret")?)
        .header("x-idempotency-key", "native-webhook")
        .json(&json!({"event":"fixture"}))
        .send()
        .await?;
    ensure!(
        expired.status() == reqwest::StatusCode::UNAUTHORIZED,
        "Rotation retained the old webhook credential"
    );
    let delivered: Value = http
        .post(&url)
        .bearer_auth(
            second["secret"]
                .as_str()
                .context("Missing rotated secret")?,
        )
        .header("x-idempotency-key", "native-webhook")
        .json(&json!({"event":"fixture"}))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    ensure!(delivered["id"].is_string(), "Webhook did not create a run");
    let repeated = http
        .post(&url)
        .bearer_auth(
            second["secret"]
                .as_str()
                .context("Missing rotated secret")?,
        )
        .header("x-idempotency-key", "native-webhook")
        .json(&json!({"event":"fixture"}))
        .send()
        .await?;
    ensure!(
        repeated.status() == reqwest::StatusCode::CONFLICT,
        "Repeated webhook delivery was admitted twice"
    );
    Ok(())
}

#[tokio::test]
#[ignore = "Requires the compiled Node runtime; run pnpm test:gpui:integration"]
async fn native_task_revisions_restore_backups_and_handoff_real_checkouts() -> Result<()> {
    let runtime = TestRuntime::start_entry("scripts/fixtures/gpui-task-revisions.mjs").await?;
    let client = &runtime.client;
    let fixture: Value = serde_json::from_slice(&std::fs::read(
        runtime.directory.path().join("fixture.json"),
    )?)?;
    let id = fixture["taskId"].as_str().context("Missing fixture task")?;
    let snapshot: Snapshot = serde_json::from_value(client.snapshot(Some(id)).await?)?;
    let task = snapshot
        .workspace
        .tasks
        .iter()
        .find(|task| task.id == id)
        .context("Missing saved task")?;
    let repo = snapshot
        .workspace
        .repositories
        .iter()
        .find(|repo| repo.id == "repo")
        .context("Missing preset project")?;
    let prompts = repo.extra["prompts"].clone();
    let mut edited_prompts = prompts.clone();
    edited_prompts[0]["text"] = json!("Edited native saved prompt 🦀");
    let _: Value = client
        .request(
            Method::PATCH,
            "/api/workspace",
            Some(&serde_json::to_value(WorkspacePatch::update(
                "repositories",
                "repo".into(),
                "prompts",
                prompts.clone(),
                edited_prompts.clone(),
            ))?),
        )
        .await?;
    ensure!(
        client
            .request::<Value>(
                Method::PATCH,
                "/api/workspace",
                Some(&serde_json::to_value(WorkspacePatch::update(
                    "repositories",
                    "repo".into(),
                    "prompts",
                    prompts,
                    json!([])
                ))?)
            )
            .await
            .is_err(),
        "Stale preset save overwrote another edit"
    );
    let template: crate::workbench::project_presets::SavedItem =
        serde_json::from_value(repo.extra["templates"][0].clone())?;
    let fields = crate::workbench::project_presets::template_fields(&template);
    let draft_id = uuid::Uuid::new_v4().to_string();
    let mut draft = json!({"id":draft_id,"title":"Native template draft","repositoryId":"repo","agentId":"","status":"draft","createdAt":chrono::Utc::now().to_rfc3339(),"messages":[],"files":[],"draft":"","example":false});
    for (key, value) in fields.as_object().context("Invalid template fields")? {
        draft[key] = value.clone();
    }
    let _: Value = client
        .request(
            Method::PATCH,
            "/api/workspace",
            Some(&serde_json::to_value(WorkspacePatch::create(
                "tasks", draft,
            )?)?),
        )
        .await?;
    let saved: Snapshot = serde_json::from_value(client.snapshot(Some(&draft_id)).await?)?;
    let created = saved
        .workspace
        .tasks
        .iter()
        .find(|task| task.id == draft_id)
        .context("Template draft missing")?;
    ensure!(
        created.draft == "Continue the native task."
            && created.agent_id.is_empty()
            && created.extra["harness"] == repo.extra["templates"][0]["harness"],
        "Template draft lost its frozen agent or objective"
    );
    let checkpoint = task.turns[0]
        .checkpoint
        .as_ref()
        .context("Native model lost checkpoint")?;
    ensure!(
        checkpoint.linked.len() == 1 && checkpoint.changes.files.len() == 2,
        "Native checkpoint files or linked project missing"
    );
    ensure!(
        checkpoint
            .changes
            .files
            .iter()
            .any(|file| file.path == "preview.png" && file.extra.get("preview").is_some()),
        "Native image preview metadata missing"
    );
    let preview: Value = client
        .post(
            "/api/tasks/file/preview",
            &json!({"id":id,"path":"preview.png","turnId":"turn"}),
        )
        .await?;
    ensure!(
        preview["after"]["kind"] == "image"
            && preview["after"]["image"]
                .as_str()
                .is_some_and(|value| value.starts_with("data:image/png;base64,")),
        "Saved image preview failed: {preview}"
    );
    let linked: Value = client
        .post(
            "/api/tasks/file/preview",
            &json!({"id":id,"path":"hello.txt","turnId":"turn","checkoutId":"link"}),
        )
        .await?;
    ensure!(
        linked["after"]["text"] == "linked change 🦀\n",
        "Linked saved preview was routed to the wrong checkout"
    );
    ensure!(
        client
            .post::<Value>(
                "/api/tasks/file/preview",
                &json!({"id":id,"path":"../outside","turnId":"turn"})
            )
            .await
            .is_err(),
        "Checkpoint traversal was accepted"
    );
    let primary = runtime.directory.path().join("project/hello.txt");
    let secondary = runtime.directory.path().join("linked/hello.txt");
    std::fs::write(&primary, "later primary edits 🦀\n")?;
    std::fs::write(&secondary, "later linked edits 🦀\n")?;
    let _: Value = client
        .post(
            "/api/tasks/turn/restore",
            &json!({"id":id,"turnId":"turn","direction":"undo"}),
        )
        .await?;
    ensure!(
        std::fs::read_to_string(&primary)? == "original 🦀\n"
            && std::fs::read_to_string(&secondary)? == "original 🦀\n",
        "Undo failed to restore both checkouts"
    );
    let undone: Snapshot = serde_json::from_value(client.snapshot(Some(id)).await?)?;
    let saved = undone
        .workspace
        .tasks
        .iter()
        .find(|task| task.id == id)
        .context("Missing undone task")?
        .turns[0]
        .checkpoint
        .as_ref()
        .context("Missing undone checkpoint")?;
    ensure!(
        saved.changes.undone.is_some() && saved.linked[0].changes.undone.is_some(),
        "Native undo state missing"
    );
    let _: Value = client
        .post(
            "/api/tasks/turn/restore",
            &json!({"id":id,"turnId":"turn","direction":"redo"}),
        )
        .await?;
    ensure!(
        std::fs::read_to_string(&primary)? == "later primary edits 🦀\n"
            && std::fs::read_to_string(&secondary)? == "later linked edits 🦀\n",
        "Redo discarded later edits instead of restoring the backup"
    );
    let _: Value = client
        .post(
            "/api/tasks/file/restore",
            &json!({"id":id,"path":"hello.txt","turnId":"turn","checkoutId":"link"}),
        )
        .await?;
    ensure!(
        std::fs::read_to_string(&secondary)? == "original 🦀\n"
            && std::fs::read_to_string(&primary)? == "later primary edits 🦀\n",
        "Single-file restore modified another project"
    );
    let _: Value = client
        .post("/api/tasks/new-session", &json!({"id":id}))
        .await?;
    let fresh: Snapshot = serde_json::from_value(client.snapshot(Some(id)).await?)?;
    let fresh_task = fresh
        .workspace
        .tasks
        .iter()
        .find(|task| task.id == id)
        .context("Missing reset task")?;
    ensure!(
        fresh_task.extra.get("sessionId").is_none_or(Value::is_null)
            && fresh_task
                .extra
                .get("contextUsage")
                .is_none_or(Value::is_null)
            && fresh_task.turns.len() == 1
            && fresh_task.messages.len() > 2,
        "Session reset lost history or retained context"
    );
    ensure!(
        client
            .post::<Value>("/api/tasks/compact", &json!({"id":id}))
            .await
            .is_err(),
        "Compact accepted a task without a session"
    );
    let _: Value = client
        .post("/api/tasks/handoff", &json!({"id":id,"target":"worktree"}))
        .await?;
    ensure!(
        std::fs::read_to_string(&primary)? == "original 🦀\n",
        "Handoff did not clean the project folder"
    );
    let fork: Value = client
        .post(
            "/api/tasks/worktree-thread",
            &json!({"id":id,"mode":"fork"}),
        )
        .await?;
    let reuse: Value = client
        .post(
            "/api/tasks/worktree-thread",
            &json!({"id":id,"mode":"reuse"}),
        )
        .await?;
    let threads: Snapshot = serde_json::from_value(client.snapshot(None).await?)?;
    let fork_task = threads
        .workspace
        .tasks
        .iter()
        .find(|task| Some(task.id.as_str()) == fork["id"].as_str())
        .context("Worktree fork missing")?;
    ensure!(
        fork_task.extra["forkedFrom"]["snapshot"].is_string() && fork_task.draft.is_empty(),
        "Fork did not preserve an independent snapshot"
    );
    let reuse_task = threads
        .workspace
        .tasks
        .iter()
        .find(|task| Some(task.id.as_str()) == reuse["id"].as_str())
        .context("Reused worktree thread missing")?;
    let worktree = reuse_task.extra["existingWorktreePath"]
        .as_str()
        .context("Reused checkout missing")?;
    ensure!(
        std::fs::read_to_string(PathBuf::from(worktree).join("hello.txt"))?
            == "later primary edits 🦀\n",
        "Handoff lost uncommitted edits"
    );
    ensure!(
        client
            .post::<Value>("/api/tasks/handoff", &json!({"id":id,"target":"main"}))
            .await
            .is_err(),
        "Handoff removed a worktree still used by another thread"
    );
    let _: Value = client
        .post(
            "/api/tasks/lifecycle",
            &json!({"id":reuse["id"],"action":"archive"}),
        )
        .await?;
    let _: Value = client
        .post("/api/tasks/handoff", &json!({"id":id,"target":"main"}))
        .await?;
    ensure!(
        std::fs::read_to_string(&primary)? == "later primary edits 🦀\n",
        "Return handoff lost uncommitted edits"
    );
    let current: Snapshot = serde_json::from_value(client.snapshot(Some(id)).await?)?;
    let current_task = current
        .workspace
        .tasks
        .iter()
        .find(|task| task.id == id)
        .context("Missing linked-project task")?;
    let before = current_task
        .extra
        .get("linkedCheckouts")
        .cloned()
        .unwrap_or(json!([]));
    let links = json!([{"id":"native-link","repositoryId":"linked","execution":"main","access":"read-only"}]);
    let _: Value = client
        .post(
            "/api/tasks/checkouts/save",
            &json!({"id":id,"before":before,"links":links}),
        )
        .await?;
    ensure!(
        client
            .post::<Value>(
                "/api/tasks/checkouts/save",
                &json!({"id":id,"before":before,"links":[]})
            )
            .await
            .is_err(),
        "Stale linked-project save was accepted"
    );
    ensure!(client.post::<Value>("/api/tasks/checkouts/save",&json!({"id":id,"before":links,"links":[{"id":"bad-link","repositoryId":"linked","execution":"main","access":"edit","branch":"invalid-main-branch"}]})).await.is_err(),"Main checkout accepted worktree settings");
    let updated: Snapshot = serde_json::from_value(client.snapshot(Some(id)).await?)?;
    let updated_task = updated
        .workspace
        .tasks
        .iter()
        .find(|task| task.id == id)
        .context("Missing updated links")?;
    ensure!(
        updated_task.extra["linkedCheckouts"] == links
            && updated_task
                .extra
                .get("sessionId")
                .is_none_or(Value::is_null),
        "Linked-project save failed to preserve access or reset the agent session"
    );
    Ok(())
}

#[tokio::test]
#[ignore = "Requires the compiled Node runtime; run pnpm test:gpui:integration"]
async fn native_scm_configuration_and_workflows_match_real_runtime() -> Result<()> {
    let runtime = TestRuntime::start().await?;
    let client = &runtime.client;
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let mut forge = TestForge(
        Command::new("node")
            .arg(root.join("scripts/fixtures/gpui-forge.mjs"))
            .arg(runtime.directory.path())
            .stdout(Stdio::null())
            .stderr(Stdio::inherit())
            .spawn()?,
    );
    let deadline = Instant::now() + Duration::from_secs(10);
    let address = loop {
        if let Ok(bytes) = std::fs::read(runtime.directory.path().join("forge-address.json")) {
            let value: Value = serde_json::from_slice(&bytes)?;
            break value["address"]
                .as_str()
                .context("Missing forge address")?
                .to_owned();
        }
        ensure!(forge.0.try_wait()?.is_none(), "Forge fixture exited");
        ensure!(Instant::now() < deadline, "Forge fixture did not start");
        tokio::time::sleep(Duration::from_millis(25)).await;
    };
    let repo_id = uuid::Uuid::new_v4().to_string();
    let path = runtime.directory.path().join("scm-project");
    std::fs::create_dir(&path)?;
    ensure!(
        Command::new("git")
            .args(["init", "-q", "-b", "main"])
            .current_dir(&path)
            .status()?
            .success(),
        "Git init failed"
    );
    let repo = json!({"id":repo_id,"name":"SCM fixture","path":path,"branch":"main"});
    let _: Value = client
        .request(
            Method::PATCH,
            "/api/workspace",
            Some(&serde_json::to_value(WorkspacePatch::create(
                "repositories",
                repo,
            )?)?),
        )
        .await?;
    let connection:Value=client.post("/api/scm/connections/save",&json!({"name":"Native Gitea","provider":"gitea","baseUrl":address,"credential":"token","token":"fixture-token"})).await?;
    ensure!(
        connection.get("token").is_none(),
        "Account response exposed token"
    );
    ensure!(client.post::<Value>("/api/scm/connections/save",&json!({"id":connection["id"],"revision":"stale","name":"Wrong revision","provider":"gitea","baseUrl":address,"credential":"token"})).await.is_err(),"Account revision conflict accepted");
    let _:Value=client.post("/api/scm/repositories/forge/bind",&json!({"repositoryId":repo_id,"forge":{"connectionId":connection["id"],"repository":"team/project"}})).await?;
    let options: Value = client
        .post(
            "/api/scm/work/options",
            &json!({"repositoryId":repo_id,"area":"issues"}),
        )
        .await?;
    ensure!(
        options["issues"] == true && options["pipelines"] == true,
        "Provider capabilities missing"
    );
    ensure!(
        options["labels"] == false,
        "Unsupported Gitea label names exposed"
    );
    let first: Value = client
        .post(
            "/api/scm/work/issues/list",
            &json!({"repositoryId":repo_id,"state":"all"}),
        )
        .await?;
    ensure!(
        first["items"].as_array().context("Missing issues")?.len() == 30 && first["next"] == "2",
        "Issue pagination lost cursor"
    );
    let next: Value = client
        .post(
            "/api/scm/work/issues/list",
            &json!({"repositoryId":repo_id,"state":"all","cursor":first["next"]}),
        )
        .await?;
    ensure!(
        next["items"][0]["id"] == "31",
        "Issue cursor returned wrong page"
    );
    let created:Value=client.post("/api/scm/work/issues/create",&json!({"repositoryId":repo_id,"title":"GPUI creation 🚀","body":"Native content","type":"Issue","assignees":["fixture"],"labels":[]})).await?;
    let selected: Value = client
        .post(
            "/api/scm/work/issues/detail",
            &json!({"repositoryId":repo_id,"id":created["id"],"refresh":true}),
        )
        .await?;
    ensure!(
        selected["issue"]["title"] == "GPUI creation 🚀"
            && selected["issue"]["assignees"] == json!(["fixture"]),
        "Issue fields were not saved"
    );
    let _:Value=client.post("/api/scm/work/issues/action",&json!({"repositoryId":repo_id,"id":created["id"],"revision":selected["issue"]["revision"],"action":"edit","title":"GPUI edited","state":"closed","assignees":[]})).await?;
    ensure!(client.post::<Value>("/api/scm/work/issues/action",&json!({"repositoryId":repo_id,"id":created["id"],"revision":selected["issue"]["revision"],"action":"edit","title":"Overwrite"})).await.is_err(),"Stale issue edit accepted");
    let search: Value = client
        .post(
            "/api/scm/work/issues/list",
            &json!({"repositoryId":repo_id,"state":"closed","query":"GPUI edited","refresh":true}),
        )
        .await?;
    ensure!(
        search["items"].as_array().context("Missing search")?.len() == 1
            && search["items"][0]["id"] == created["id"],
        "Issue state/search filters did not reach forge"
    );
    let comments: Value = client
        .post(
            "/api/scm/work/issues/detail",
            &json!({"repositoryId":repo_id,"id":"1","refresh":true}),
        )
        .await?;
    let more: Value = client
        .post(
            "/api/scm/work/issues/detail",
            &json!({"repositoryId":repo_id,"id":"1","cursor":comments["next"]}),
        )
        .await?;
    ensure!(
        comments["comments"]
            .as_array()
            .context("Missing comments")?
            .len()
            == 50
            && more["comments"][0]["id"] == "51",
        "Discussion pagination failed"
    );
    let definitions: Value = client
        .post(
            "/api/scm/work/pipelines/definitions",
            &json!({"repositoryId":repo_id}),
        )
        .await?;
    ensure!(
        definitions["items"][0]["id"] == "ci.yaml",
        "Workflow definitions failed"
    );
    let _:Value=client.post("/api/scm/work/pipelines/action",&json!({"repositoryId":repo_id,"action":"run","definition":"ci.yaml","ref":"main","inputs":{"release":"nightly"}})).await?;
    let _: Value = client
        .post(
            "/api/scm/work/pipelines/action",
            &json!({"repositoryId":repo_id,"action":"disable","id":"ci.yaml"}),
        )
        .await?;
    let disabled: Value = client
        .post(
            "/api/scm/work/pipelines/definitions",
            &json!({"repositoryId":repo_id}),
        )
        .await?;
    ensure!(
        disabled["items"][0]["state"] == "disabled",
        "Workflow disable failed"
    );
    let runs: Value = client
        .post(
            "/api/scm/work/pipelines/list",
            &json!({"repositoryId":repo_id,"refresh":true}),
        )
        .await?;
    ensure!(
        runs["items"].as_array().context("Missing runs")?.len() == 2,
        "Dispatched pipeline missing"
    );
    let pipeline: Value = client
        .post(
            "/api/scm/work/pipelines/detail",
            &json!({"repositoryId":repo_id,"id":"1"}),
        )
        .await?;
    ensure!(
        pipeline["jobs"][0]["steps"][0]["name"] == "Build",
        "Pipeline jobs failed"
    );
    let overview: Value = client
        .post(
            "/api/scm/pulls/overview",
            &json!({"repositoryId":repo_id,"state":"all","refresh":true}),
        )
        .await?;
    ensure!(
        overview["pulls"][0]["number"] == 1,
        "Native PR overview failed: {overview}"
    );
    let pull: crate::model::PullDetail = client
        .post(
            "/api/scm/pulls/detail",
            &json!({"repositoryId":repo_id,"number":1,"refresh":true}),
        )
        .await?;
    ensure!(
        pull.warnings.is_empty(),
        "PR fixture warnings: {:?}",
        pull.warnings
    );
    ensure!(
        pull.comments.len() == 50 && pull.comments[0].kind == "comment",
        "PR discussion decoding failed"
    );
    let stack = pull.stack.as_ref().context("Missing native PR stack")?;
    ensure!(
        stack.complete
            && stack.root_number == 1
            && stack.size == 2
            && stack.members[1].parent_number == Some(1),
        "PR stack decoding failed"
    );
    let stack_task: Value = client.post("/api/scm/pulls/task", &json!({"repositoryId":repo_id,"number":1,"headSha":pull.pull.head_sha,"objective":"Update the stack","stackAction":"update","checkoutMode":"new-branch","run":false})).await?;
    let stack_snapshot: Snapshot = serde_json::from_value(client.snapshot(None).await?)?;
    let draft = stack_snapshot
        .workspace
        .tasks
        .iter()
        .find(|task| stack_task["id"] == task.id)
        .context("Missing stack update task")?;
    ensure!(
        draft.status == crate::model::TaskStatus::Draft
            && draft
                .draft
                .contains("--force-with-lease=<ref>:<expected-tip>")
            && draft.draft.contains("feature-top")
            && draft.messages.is_empty(),
        "Native stack task did not retain safe draft instructions"
    );
    ensure!(client.post::<Value>("/api/scm/pulls/task", &json!({"repositoryId":repo_id,"number":1,"headSha":"f".repeat(40),"objective":"Stale stack update","stackAction":"update","run":false})).await.is_err(), "Stale stack revision accepted");
    let head = &pull.pull.head_sha;
    for action in [
        json!({"action":"comment","body":"Native review comment"}),
        json!({"action":"review","event":"approve","body":"Verified"}),
        json!({"action":"reviewers","operation":"add","reviewers":["reviewer"],"teams":[]}),
        json!({"action":"edit","title":"Native PR edited","body":"Updated description","base":"main"}),
        json!({"action":"close"}),
        json!({"action":"reopen"}),
    ] {
        let mut action = action;
        action["repositoryId"] = json!(repo_id);
        action["number"] = json!(1);
        action["headSha"] = json!(head);
        let _: Value = client.post("/api/scm/pulls/action", &action).await?;
    }
    ensure!(client.post::<Value>("/api/scm/pulls/action",&json!({"repositoryId":repo_id,"number":1,"headSha":"c".repeat(40),"action":"close"})).await.is_err(),"Stale pull head accepted");
    let edited: crate::model::PullDetail = client
        .post(
            "/api/scm/pulls/detail",
            &json!({"repositoryId":repo_id,"number":1,"refresh":true}),
        )
        .await?;
    ensure!(
        edited.pull.title == "Native PR edited"
            && edited.pull.state == "open"
            && edited
                .comments
                .iter()
                .any(|comment| comment.kind == "review"),
        "PR edit/review/reopen failed"
    );
    let published:Value=client.post("/api/scm/pulls/create",&json!({"repositoryId":repo_id,"title":"Native published PR","body":"New PR","head":"feature-new","base":"main","draft":false})).await?;
    ensure!(published["number"] == 3, "PR creation failed: {published}");
    let _:Value=client.post("/api/scm/pulls/action",&json!({"repositoryId":repo_id,"number":1,"headSha":head,"action":"merge","method":"squash"})).await?;
    let merged: crate::model::PullDetail = client
        .post(
            "/api/scm/pulls/detail",
            &json!({"repositoryId":repo_id,"number":1,"refresh":true}),
        )
        .await?;
    ensure!(merged.pull.state == "merged", "PR merge failed");
    let scoped: Value = client
        .post(
            "/api/agents/settings/read",
            &json!({"scope":"environment-project","repositoryId":repo_id}),
        )
        .await?;
    let mut after = scoped["value"].clone();
    after["taskDefaults"] = json!({"execution":"worktree","setupCommand":"pnpm install","worktreeFromOrigin":false,"submodules":"direct"});
    let saved:Value=client.post("/api/agents/settings/save",&json!({"scope":"environment-project","repositoryId":repo_id,"before":scoped["value"],"after":after})).await?;
    ensure!(
        saved["value"] == after,
        "Save did not return the acknowledged settings baseline"
    );
    let snapshot: Snapshot = serde_json::from_value(client.snapshot(None).await?)?;
    let repository = snapshot
        .workspace
        .repositories
        .iter()
        .find(|repo| repo.id == repo_id)
        .context("Missing configured project")?;
    let defaults =
        crate::workbench::task_defaults::resolve(&snapshot, repository)?.fields(false, None)?;
    ensure!(
        defaults
            == json!({"execution":"worktree","setupCommand":"pnpm install","worktreeFromOrigin":false,"submodules":"direct"}),
        "Native task did not inherit project checkout defaults"
    );
    ensure!(client.post::<Value>("/api/agents/settings/save",&json!({"scope":"environment-project","repositoryId":repo_id,"before":scoped["value"],"after":{}})).await.is_err(),"Stale project settings accepted");
    let requests = std::fs::read_to_string(runtime.directory.path().join("forge-requests.jsonl"))?;
    ensure!(
        requests
            .lines()
            .filter_map(|line| serde_json::from_str::<Value>(line).ok())
            .any(|event| event["path"]
                == "/api/v1/repos/team/project/actions/workflows/ci.yaml/dispatches"
                && event["input"] == json!({"ref":"main","inputs":{"release":"nightly"}})),
        "Dispatch inputs were not preserved"
    );
    Ok(())
}

#[tokio::test]
#[ignore = "Requires the compiled Node runtime; run pnpm test:gpui:integration"]
async fn native_scoped_agents_freeze_task_launch_settings_and_preserve_conflicts() -> Result<()> {
    let runtime = TestRuntime::start().await?;
    let client = &runtime.client;
    let repo_id = uuid::Uuid::new_v4().to_string();
    let path = runtime.directory.path().join("scoped-project");
    std::fs::create_dir(&path)?;
    let repo =
        json!({"id":repo_id,"name":"Scoped project","path":path,"branch":"","kind":"folder"});
    let _: Value = client
        .request(
            Method::PATCH,
            "/api/workspace",
            Some(&serde_json::to_value(WorkspacePatch::create(
                "repositories",
                repo,
            )?)?),
        )
        .await?;
    let shared: Value = client
        .post(
            "/api/agents/settings/read",
            &json!({"scope":"global","includeAgents":true}),
        )
        .await?;
    let choices = crate::workbench::scoped_agents::effective_agents(&shared)?;
    let codex = choices
        .iter()
        .find(|agent| agent.id == "dovo:codex")
        .context("Built-in agent missing")?;
    let mut global_agent = serde_json::to_value(codex)?;
    global_agent["name"] = json!("Scoped Codex");
    global_agent["model"] = json!("global-model");
    let mut after = shared["value"].clone();
    after["agents"] = json!([global_agent]);
    let _: Value = client
        .post(
            "/api/agents/settings/save",
            &json!({"scope":"global","includeAgents":true,"before":shared["value"],"after":after}),
        )
        .await?;
    let computer: Value = client
        .post(
            "/api/agents/settings/read",
            &json!({"scope":"environment","includeAgents":true}),
        )
        .await?;
    let mut computer_agent = global_agent.clone();
    computer_agent["model"] = json!("computer-model");
    computer_agent["args"] = json!(["--native-fixture"]);
    computer_agent["executablePath"] = json!("/tmp/native-fixture-agent");
    computer_agent["permission"] = json!("ask");
    let mut after = computer["value"].clone();
    after["agents"] = json!([computer_agent]);
    let _:Value=client.post("/api/agents/settings/save",&json!({"scope":"environment","includeAgents":true,"before":computer["value"],"after":after})).await?;
    ensure!(client.post::<Value>("/api/agents/settings/save",&json!({"scope":"environment","includeAgents":true,"before":computer["value"],"after":{}})).await.is_err(),"Stale agent configuration accepted");
    let project: Value = client
        .post(
            "/api/agents/settings/read",
            &json!({"scope":"environment-project","repositoryId":repo_id,"includeAgents":true}),
        )
        .await?;
    let inherited = crate::workbench::scoped_agents::effective_agents(&project)?;
    ensure!(
        inherited
            .iter()
            .find(|agent| agent.id == codex.id)
            .is_some_and(|agent| agent.model == "computer-model"),
        "Computer agent override was lost"
    );
    let mut project_agent = computer_agent.clone();
    project_agent["instructions"] = json!("Project instructions");
    let mut after = project["value"].clone();
    after["agents"] = json!([project_agent]);
    let saved:Value=client.post("/api/agents/settings/save",&json!({"scope":"environment-project","repositoryId":repo_id,"includeAgents":true,"before":project["value"],"after":after})).await?;
    let settings: Value = client
        .post(
            "/api/agents/settings/read",
            &json!({"scope":"environment-project","repositoryId":repo_id}),
        )
        .await?;
    let mut defaults_after = settings["value"].clone();
    defaults_after["taskDefaults"] = json!({"execution":"worktree","permission":"ask","harness":{"provider":"cursor","model":"default-model","reasoning":"","instructions":"Default instructions","permission":"full-access","endpoint":""}});
    defaults_after["taskBehavior"] =
        json!({"continueAfterRestart":false,"inactiveDays":7,"settleInactive":true});
    let _:Value=client.post("/api/agents/settings/save",&json!({"scope":"environment-project","repositoryId":repo_id,"before":settings["value"],"after":defaults_after})).await?;
    let skill_directory = runtime.directory.path().join("native-skill");
    std::fs::create_dir(&skill_directory)?;
    let skill_path = skill_directory.join("SKILL.md");
    std::fs::write(
        &skill_path,
        "---\nname: native-bundle\ndescription: Native supporting file test\n---\nUse scripts/check.sh.\n",
    )?;
    std::fs::create_dir(skill_directory.join("scripts"))?;
    std::fs::write(
        skill_directory.join("scripts/check.sh"),
        "echo native-bundle\n",
    )?;
    let imported: Value = client
        .post("/api/agents/skills/import", &json!({"path":skill_path}))
        .await?;
    ensure!(
        imported["name"] == "native-bundle"
            && imported["sourcePath"].as_str() == skill_path.to_str(),
        "Skill supporting files lost their source directory"
    );
    let resources: Value = client
        .post(
            "/api/agents/settings/read",
            &json!({"scope":"environment-project","repositoryId":repo_id}),
        )
        .await?;
    let mut after = resources["value"].clone();
    after["resources"] = json!({"mcpServers":[],"skills":[imported],"hooks":[]});
    let saved_resources:Value=client.post("/api/agents/settings/save",&json!({"scope":"environment-project","repositoryId":repo_id,"before":resources["value"],"after":after})).await?;
    ensure!(
        saved_resources["value"]["resources"]["skills"][0]["sourcePath"] == imported["sourcePath"],
        "Saving imported skill lost supporting files"
    );
    ensure!(client.post::<Value>("/api/agents/settings/save",&json!({"scope":"environment-project","repositoryId":repo_id,"before":resources["value"],"after":resources["value"]})).await.is_err(),"Stale resource save accepted");
    let snapshot: Snapshot = serde_json::from_value(client.snapshot(None).await?)?;
    let repository = snapshot
        .workspace
        .repositories
        .iter()
        .find(|repo| repo.id == repo_id)
        .context("Missing project")?;
    let default_fields =
        crate::workbench::task_defaults::task_fields(&snapshot, repository, None, None)?;
    ensure!(
        default_fields["execution"] == "main"
            && default_fields["harness"]["provider"] == "cursor"
            && default_fields["harness"]["permission"] == "read-only",
        "Default harness permissions or folder constraints differ from protocol"
    );
    let agents = crate::workbench::scoped_agents::effective_agents(&saved)?;
    let selected = agents
        .iter()
        .find(|agent| agent.id == codex.id)
        .context("Project override missing")?;
    let fields =
        crate::workbench::task_defaults::task_fields(&snapshot, repository, None, Some(selected))?;
    ensure!(
        fields["harness"]["instructions"] == "Project instructions"
            && fields["harness"]["args"] == json!(["--native-fixture"])
            && fields["harness"]["permission"] == "ask",
        "Selected harness launch settings were lost"
    );
    let task_id = uuid::Uuid::new_v4().to_string();
    let mut task = json!({"id":task_id,"repositoryId":repo_id,"agentId":codex.id,"title":"Scoped native task","status":"draft","createdAt":chrono::Utc::now().to_rfc3339(),"messages":[],"files":[],"draft":"","example":false});
    for (key, value) in fields.as_object().context("Invalid task fields")? {
        task[key] = value.clone();
    }
    let _: Value = client
        .request(
            Method::PATCH,
            "/api/workspace",
            Some(&serde_json::to_value(WorkspacePatch::create(
                "tasks", task,
            )?)?),
        )
        .await?;
    let document: Value = client
        .post(
            "/api/agents/settings/read",
            &json!({"scope":"environment-project","repositoryId":repo_id,"includeAgents":true}),
        )
        .await?;
    let mut resource_override = document["value"].clone();
    let agents = resource_override["agents"]
        .as_array_mut()
        .context("Missing scoped configurations")?;
    let named = agents
        .iter_mut()
        .find(|agent| agent["id"] == codex.id)
        .context("Missing selected configuration")?;
    let launch = named.clone();
    named["resources"] = json!({"mcpServers":[],"skills":[{"name":"agent-only","description":"Agent scope","content":"Native named configuration resource","enabled":true}]});
    let named_save: Value = client.post("/api/agents/settings/save", &json!({"scope":"environment-project","repositoryId":repo_id,"includeAgents":true,"before":document["value"],"after":resource_override})).await?;
    let saved_agent = named_save["value"]["agents"]
        .as_array()
        .context("Missing saved configurations")?
        .iter()
        .find(|agent| agent["id"] == codex.id)
        .context("Named save removed the selected configuration")?;
    ensure!(
        saved_agent["resources"]["skills"][0]["name"] == "agent-only"
            && saved_agent["model"] == launch["model"],
        "Named resource save lost launch settings"
    );
    ensure!(
        named_save["value"]["resources"] == document["value"]["resources"],
        "Named resource save changed shared resources"
    );
    let current: Value = client
        .post(
            "/api/agents/settings/read",
            &json!({"scope":"environment-project","repositoryId":repo_id,"includeAgents":true}),
        )
        .await?;
    let mut after = current["value"].clone();
    after["agents"] = json!([]);
    let _:Value=client.post("/api/agents/settings/save",&json!({"scope":"environment-project","repositoryId":repo_id,"includeAgents":true,"before":current["value"],"after":after})).await?;
    let snapshot: Snapshot = serde_json::from_value(client.snapshot(Some(&task_id)).await?)?;
    let task = snapshot
        .workspace
        .tasks
        .iter()
        .find(|task| task.id == task_id)
        .context("Missing native task")?;
    ensure!(
        task.extra.get("harness") == fields.get("harness"),
        "Removing an override changed an established task harness"
    );
    let settings: Value = client
        .post(
            "/api/agents/settings/read",
            &json!({"scope":"environment-project","repositoryId":repo_id}),
        )
        .await?;
    ensure!(
        settings["value"]["taskBehavior"]["inactiveDays"] == 7
            && settings["value"]["taskDefaults"]["harness"]["provider"] == "cursor",
        "Saving configurations lost unrelated defaults"
    );
    Ok(())
}

#[tokio::test]
#[ignore = "Requires the compiled Node runtime; run pnpm test:gpui:integration"]
async fn rust_client_matches_real_runtime_contracts() -> Result<()> {
    let runtime = TestRuntime::start().await?;
    let client = &runtime.client;
    let initial: Snapshot = serde_json::from_value(client.snapshot(None).await?)?;
    initial.validate()?;
    ensure!(initial.owner, "Local owner credential was not retained");
    let _: Value = client
        .post(
            "/api/runtime/preferences/save",
            &json!({"enableArtifacts":true}),
        )
        .await?;
    let prefs: Value = client
        .post("/api/runtime/preferences/read", &json!({}))
        .await?;
    ensure!(
        prefs.get("enableArtifacts") == Some(&json!(true)),
        "Preferences did not save"
    );

    let repository_id = uuid::Uuid::new_v4().to_string();
    let agent_id = uuid::Uuid::new_v4().to_string();
    let task_id = uuid::Uuid::new_v4().to_string();
    let repository_path = runtime.directory.path().join("project");
    std::fs::create_dir(&repository_path)?;
    let repo = json!({"id":repository_id,"name":"Test project","path":repository_path,"branch":"","kind":"folder"});
    let agent = json!({"id":agent_id,"name":"Test agent","provider":"codex","model":"","instructions":"","permission":"ask","endpoint":""});
    let task = json!({"id":task_id,"title":"Native integration","repositoryId":repository_id,"agentId":agent_id,"status":"draft","createdAt":chrono::Utc::now().to_rfc3339(),"messages":[],"files":[],"draft":"","example":false});
    for (collection, value) in [("repositories", repo), ("agents", agent), ("tasks", task)] {
        let patch = WorkspacePatch::create(collection, value)?;
        let _: Value = client
            .request(
                Method::PATCH,
                "/api/workspace",
                Some(&serde_json::to_value(patch)?),
            )
            .await?;
    }

    let side: Value = client
        .post(
            "/api/tasks/side-chat/save",
            &json!({"id":task_id,"title":"Native side chat"}),
        )
        .await?;
    let chat_id = side
        .get("id")
        .and_then(Value::as_str)
        .context("Missing side chat ID")?;
    let _: Value = client
        .post(
            "/api/tasks/side-chat/save",
            &json!({"id":task_id,"chatId":chat_id,"draft":"Unsent question"}),
        )
        .await?;
    let at = (chrono::Utc::now() + chrono::Duration::days(1)).to_rfc3339();
    let scheduled: Value = client
        .post(
            "/api/tasks/schedule",
            &json!({"id":task_id,"text":"Native follow-up","at":at}),
        )
        .await?;
    let scheduled_id = scheduled
        .get("id")
        .and_then(Value::as_str)
        .context("Missing follow-up ID")?;
    let with_controls: Snapshot = serde_json::from_value(client.snapshot(Some(&task_id)).await?)?;
    let controlled = with_controls
        .workspace
        .tasks
        .iter()
        .find(|task| task.id == task_id)
        .context("Task missing")?;
    ensure!(
        controlled
            .side_chats
            .iter()
            .any(|chat| chat.id == chat_id && chat.draft == "Unsent question"),
        "Native side chat decoding lost its draft"
    );
    ensure!(
        controlled
            .scheduled_messages
            .iter()
            .any(|message| message.id == scheduled_id && message.text == "Native follow-up"),
        "Native follow-up decoding failed"
    );
    let _: Value = client
        .post(
            "/api/tasks/schedule",
            &json!({"id":task_id,"removeId":scheduled_id}),
        )
        .await?;
    let _: Value = client
        .post(
            "/api/tasks/side-chat/save",
            &json!({"id":task_id,"chatId":chat_id,"remove":true}),
        )
        .await?;

    let ticket: Value = client
        .post(
            &format!("/api/sync/ticket?format=4&history=paged&task={task_id}"),
            &json!({}),
        )
        .await?;
    let socket_url = client.websocket_url(
        "/ws/sync",
        ticket
            .get("ticket")
            .and_then(Value::as_str)
            .context("Missing sync ticket")?,
    )?;
    let (mut socket, _) = connect_async(socket_url.as_str()).await?;
    let mut replica = Replica::default();
    socket
        .send(Message::Text(replica.resume().to_string().into()))
        .await?;
    let received = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if let Message::Text(text) = socket.next().await.context("Stream closed")??
                && let Some(snapshot) = replica.apply(serde_json::from_str(&text)?)?
            {
                return Ok::<_, anyhow::Error>(snapshot);
            }
        }
    })
    .await??;
    ensure!(
        received
            .workspace
            .tasks
            .iter()
            .any(|task| task.id == task_id),
        "Native sync omitted the created task"
    );
    let patch = WorkspacePatch::update(
        "tasks",
        task_id.clone(),
        "title",
        json!("Native integration"),
        json!("Updated from Rust 🦀"),
    );
    let _: Value = client
        .request(
            Method::PATCH,
            "/api/workspace",
            Some(&serde_json::to_value(patch)?),
        )
        .await?;
    let updated = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if let Message::Text(text) = socket.next().await.context("Stream closed")??
                && let Some(snapshot) = replica.apply(serde_json::from_str(&text)?)?
                && snapshot
                    .workspace
                    .tasks
                    .iter()
                    .any(|task| task.title == "Updated from Rust 🦀")
            {
                return Ok::<_, anyhow::Error>(snapshot);
            }
        }
    })
    .await??;
    updated.validate()?;
    let conflicting = WorkspacePatch::update(
        "tasks",
        task_id.clone(),
        "title",
        json!("Native integration"),
        json!("Stale write"),
    );
    ensure!(
        client
            .request::<Value>(
                Method::PATCH,
                "/api/workspace",
                Some(&serde_json::to_value(conflicting)?)
            )
            .await
            .is_err(),
        "Runtime accepted a stale native edit"
    );
    std::fs::write(repository_path.join("native.txt"), "original 🦀")?;
    let files: Value = client
        .post("/api/tasks/files/list", &json!({"id":task_id}))
        .await?;
    let paths: Vec<String> =
        serde_json::from_value(files.get("files").context("Missing file list")?.clone())?;
    ensure!(
        paths.iter().any(|path| path == "native.txt"),
        "Native file list omitted the test file"
    );
    let read: Value = client
        .post(
            "/api/tasks/files/read",
            &json!({"id":task_id,"path":"native.txt"}),
        )
        .await?;
    ensure!(
        read.get("contents") == Some(&json!("original 🦀")),
        "File contents did not match"
    );
    let _:Value=client.post("/api/tasks/files/write",&json!({"id":task_id,"path":"native.txt","expectedContents":"original 🦀","contents":"edited"})).await?;
    ensure!(
        std::fs::read_to_string(repository_path.join("native.txt"))? == "edited",
        "Native file edit was not applied"
    );
    ensure!(client.post::<Value>("/api/tasks/files/write",&json!({"id":task_id,"path":"native.txt","expectedContents":"original 🦀","contents":"stale"})).await.is_err(),"Stale file edit overwrote current contents");
    let artifact:Value=client.post("/api/artifacts/create",&json!({"taskId":task_id,"title":"Native preview","format":"html","content":"<h1>GPUI artifact</h1>"})).await?;
    let artifact_id = artifact
        .pointer("/artifact/id")
        .and_then(Value::as_str)
        .context("Missing artifact ID")?;
    let read: Value = client
        .post(
            "/api/artifacts/read",
            &json!({"taskId":task_id,"id":artifact_id}),
        )
        .await?;
    ensure!(
        read.pointer("/artifact/content") == Some(&json!("<h1>GPUI artifact</h1>")),
        "Artifact read did not preserve HTML"
    );
    let terminal: Value = client
        .post("/api/terminals/ensure", &json!({"taskId":task_id}))
        .await?;
    let terminal_id = terminal
        .get("id")
        .and_then(Value::as_str)
        .context("Missing terminal ID")?;
    let ticket: Value = client
        .post("/api/terminals/ticket", &json!({"id":terminal_id}))
        .await?;
    ensure!(
        ticket["byteInput"] == true,
        "Runtime did not advertise byte input"
    );
    let terminal_url = client.websocket_url(
        "/ws/terminal",
        ticket
            .get("ticket")
            .and_then(Value::as_str)
            .context("Missing terminal ticket")?,
    )?;
    let (mut terminal_socket, _) = connect_async(terminal_url.as_str()).await?;
    terminal_socket
        .send(Message::Text(
            json!({"type":"input","data":"printf 'GPUI_%s\\n' terminal_verified\n"})
                .to_string()
                .into(),
        ))
        .await?;
    let mut parser = vt100::Parser::new(30, 100, 100);
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            match terminal_socket.next().await.context("Terminal closed")?? {
                Message::Text(text) => parser.process(text.as_bytes()),
                Message::Binary(bytes) => parser.process(&bytes),
                Message::Ping(bytes) => terminal_socket.send(Message::Pong(bytes)).await?,
                _ => {}
            }
            if parser
                .screen()
                .contents()
                .contains("GPUI_terminal_verified")
            {
                return Ok::<(), anyhow::Error>(());
            }
        }
    })
    .await??;
    terminal_socket.close(None).await?;
    let _: Value = client
        .post("/api/terminals/close", &json!({"id":terminal_id}))
        .await?;
    let _: Value = client
        .post(
            "/api/tasks/lifecycle",
            &json!({"id":task_id,"action":"archive"}),
        )
        .await?;
    let _: Value = client
        .post(
            "/api/tasks/lifecycle",
            &json!({"id":task_id,"action":"restore"}),
        )
        .await?;
    socket.close(None).await?;

    let settings: Value = client
        .post("/api/agents/settings/read", &json!({"scope":"environment"}))
        .await?;
    let before = settings
        .get("value")
        .context("Missing scoped settings")?
        .clone();
    let mut after = before.clone();
    after["resources"] = json!({"mcpServers":[],"skills":[{"name":"native-skill","description":"Native test skill","content":"Check native behavior.","enabled":true}]});
    let saved: Value = client
        .post(
            "/api/agents/settings/save",
            &json!({"scope":"environment","before":before,"after":after}),
        )
        .await?;
    ensure!(
        saved.pointer("/value/resources/skills/0/name") == Some(&json!("native-skill")),
        "Native scoped skill was not saved"
    );
    ensure!(
        client
            .post::<Value>(
                "/api/agents/settings/save",
                &json!({"scope":"environment","before":before,"after":after})
            )
            .await
            .is_err(),
        "Stale scoped settings overwrote another edit"
    );
    let code: Value = client
        .post("/api/pair/code", &json!({"autoApprove":true}))
        .await?;
    let proof: Value = public_post(
        &client.connection.address,
        "/api/pair/request",
        &json!({"protocolVersion":2,"code":code["code"],"name":"Rust test client"}),
    )
    .await?;
    let claim: Value = public_post(&client.connection.address, "/api/pair/claim", &proof).await?;
    let _: Value = public_post(&client.connection.address, "/api/pair/confirm", &proof).await?;
    let paired = RuntimeClient::new(Connection {
        address: client.connection.address.clone(),
        token: claim
            .get("token")
            .and_then(Value::as_str)
            .context("No device credential")?
            .to_owned(),
    })?;
    let snapshot: Snapshot = serde_json::from_value(paired.snapshot(None).await?)?;
    ensure!(
        !snapshot.owner,
        "A paired device unexpectedly acquired owner privileges"
    );
    Ok(())
}

struct ManagedRuntime {
    directory: tempfile::TempDir,
    cli: PathBuf,
}
impl Drop for ManagedRuntime {
    fn drop(&mut self) {
        if self.directory.path().join("server.json").exists() {
            match Command::new("node")
                .arg(&self.cli)
                .args(["stop", "--data-dir"])
                .arg(self.directory.path())
                .arg("--json")
                .output()
            {
                Ok(output) if output.status.success() => {}
                Ok(output) => eprintln!(
                    "Isolated runtime cleanup failed: {}",
                    String::from_utf8_lossy(&output.stderr)
                ),
                Err(error) => eprintln!("Could not stop the isolated runtime: {error}"),
            }
        }
    }
}
#[tokio::test]
#[ignore = "Requires the compiled Node runtime; run pnpm test:gpui:integration"]
async fn native_local_start_preserves_listen_settings_and_reuses_the_process() -> Result<()> {
    let guard = ManagedRuntime {
        directory: tempfile::tempdir()?,
        cli: PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../api/dist/server-cli.js"),
    };
    let listener = std::net::TcpListener::bind("127.0.0.1:0")?;
    let port = listener.local_addr()?.port();
    drop(listener);
    std::fs::write(
        guard.directory.path().join("runtime-listen.json"),
        serde_json::to_vec(
            &json!({"address":format!("http://127.0.0.1:{port}"),"bindHost":"127.0.0.1"}),
        )?,
    )?;
    let first =
        crate::local_runtime::attach_or_start_in(guard.directory.path().to_owned(), None).await?;
    ensure!(
        first.address == format!("http://127.0.0.1:{port}"),
        "Native startup changed the saved HTTP listening address"
    );
    let path = guard.directory.path().join("runtime-connection.json");
    let first_record: Value = serde_json::from_slice(&std::fs::read(&path)?)?;
    let second =
        crate::local_runtime::attach_or_start_in(guard.directory.path().to_owned(), None).await?;
    let second_record: Value = serde_json::from_slice(&std::fs::read(path)?)?;
    ensure!(
        first_record["pid"] == second_record["pid"],
        "Native startup duplicated the runtime process"
    );
    ensure!(
        first.token == second.token,
        "Native reattachment replaced the owner credential"
    );
    let config: Value =
        serde_json::from_slice(&std::fs::read(guard.directory.path().join("server.json"))?)?;
    ensure!(
        config["port"] == json!(port),
        "Native setup did not preserve the saved port"
    );
    let before_config = std::fs::read(guard.directory.path().join("server.json"))?;
    let mismatch = crate::local_runtime::attach_or_start_in(
        guard.directory.path().to_owned(),
        Some(guard.directory.path().join("other.sqlite")),
    )
    .await;
    ensure!(
        mismatch.is_err(),
        "An explicit database mismatch attached the wrong runtime"
    );
    ensure!(
        std::fs::read(guard.directory.path().join("server.json"))? == before_config,
        "A database mismatch changed the saved configuration"
    );
    Ok(())
}

#[tokio::test]
#[ignore = "Requires the compiled Node runtime; run pnpm test:gpui:integration"]
async fn native_dependency_saves_local_draft_and_preserves_conflicts() -> Result<()> {
    let runtime = TestRuntime::start().await?;
    let client = &runtime.client;
    let repository = uuid::Uuid::new_v4().to_string();
    let agent = uuid::Uuid::new_v4().to_string();
    let source = uuid::Uuid::new_v4().to_string();
    let target = uuid::Uuid::new_v4().to_string();
    let path = runtime.directory.path().join("project");
    std::fs::create_dir(&path)?;
    let task = |id: &str| json!({"id":id,"title":"Dependency fixture","repositoryId":repository,"agentId":agent,"status":"draft","createdAt":chrono::Utc::now().to_rfc3339(),"messages":[],"files":[],"draft":"","example":false});
    for (collection, value) in [
        (
            "repositories",
            json!({"id":repository,"name":"Fixture","path":path,"branch":"","kind":"folder"}),
        ),
        (
            "agents",
            json!({"id":agent,"name":"Fixture","provider":"codex","model":"","instructions":"","permission":"ask","endpoint":""}),
        ),
        ("tasks", task(&source)),
        ("tasks", task(&target)),
    ] {
        client
            .request::<Value>(
                Method::PATCH,
                "/api/workspace",
                Some(&serde_json::to_value(WorkspacePatch::create(
                    collection, value,
                )?)?),
            )
            .await?;
    }
    crate::service::chain_task(
        client,
        &target,
        &source,
        String::new(),
        "Native local request".into(),
    )
    .await?;
    let snapshot: Snapshot = serde_json::from_value(client.snapshot(None).await?)?;
    let task = snapshot
        .workspace
        .tasks
        .iter()
        .find(|task| task.id == target)
        .context("Missing target")?;
    ensure!(
        task.draft == "Native local request",
        "Local request was not saved"
    );
    ensure!(
        task.extra["startAfter"]["taskId"] == source
            && task.extra["startAfter"]["text"] == "Native local request",
        "Dependency lost its request"
    );
    ensure!(
        task.turns.is_empty(),
        "Chaining unexpectedly started a provider"
    );
    ensure!(
        crate::service::chain_task(
            client,
            &source,
            &target,
            String::new(),
            "Source request".into()
        )
        .await
        .is_err(),
        "Cycle was accepted"
    );
    client
        .post::<Value>(
            "/api/tasks/start-after",
            &json!({"id":target,"sourceId":null}),
        )
        .await?;
    ensure!(
        crate::service::chain_task(
            client,
            &target,
            &source,
            String::new(),
            "Stale overwrite".into()
        )
        .await
        .is_err(),
        "Stale draft overwrite was accepted"
    );
    let snapshot: Snapshot = serde_json::from_value(client.snapshot(None).await?)?;
    let task = snapshot
        .workspace
        .tasks
        .iter()
        .find(|task| task.id == target)
        .context("Missing target")?;
    ensure!(
        task.draft == "Native local request" && !task.extra.contains_key("startAfter"),
        "Failed save changed the dependency or request"
    );
    Ok(())
}

#[tokio::test]
#[ignore = "Requires the compiled Node runtime; run pnpm test:gpui:integration"]
async fn native_child_transcripts_scopes_and_stop_tokens_match_main() -> Result<()> {
    use crate::model::NativeThreadPage;
    let runtime = TestRuntime::start_entry("scripts/fixtures/gpui-child-agents.mjs").await?;
    let client = &runtime.client;
    let fixture: Value = serde_json::from_slice(&std::fs::read(
        runtime.directory.path().join("fixture.json"),
    )?)?;
    let id = fixture["taskId"].as_str().context("Missing parent ID")?;
    let snapshot: Snapshot = serde_json::from_value(client.snapshot(Some(id)).await?)?;
    let task = snapshot
        .workspace
        .tasks
        .iter()
        .find(|task| task.id == id)
        .context("Missing parent")?;
    let original = serde_json::to_value(&task.messages)?;
    let todos = task
        .native_todos
        .as_ref()
        .context("Missing provider plan")?;
    ensure!(
        todos.len() == 3 && todos[1].status == crate::model::TodoStatus::InProgress,
        "Provider plan did not decode"
    );
    let family = crate::task_family::ids(&snapshot.workspace.tasks, id);
    ensure!(
        family.len() == 2 && crate::task_family::agents(&snapshot.workspace.tasks, id).len() == 2,
        "Delegated family is incomplete"
    );
    let token = crate::task_family::run_token(&snapshot.workspace.tasks, id)?;
    ensure!(
        fixture["runToken"] == token,
        "Rust stop token differs from the protocol's JavaScript token"
    );
    let child = task
        .subagents
        .as_ref()
        .context("Missing agents")?
        .iter()
        .find(|agent| agent.source.as_deref() != Some("dovo"))
        .context("Missing native child")?;
    ensure!(
        child.native_working(),
        "Fixture child is not live after the parent reply"
    );
    let mut input =
        json!({"taskId":id,"id":child.id,"provider":child.provider,"sessionId":child.session_id});
    let page: NativeThreadPage = client.post("/api/tasks/native-thread", &input).await?;
    ensure!(
        page.entries.len() == 50 && page.before.as_deref() == Some("entry-5"),
        "Native history was not paged"
    );
    input["before"] = json!(page.before);
    let older: NativeThreadPage = client.post("/api/tasks/native-thread", &input).await?;
    ensure!(
        older.entries.len() == 5 && older.before.is_none(),
        "Older native history is incomplete"
    );
    input["sessionId"] = json!("wrong-session");
    ensure!(
        client
            .post::<Value>("/api/tasks/native-thread", &input)
            .await
            .is_err(),
        "Another native session was readable"
    );
    let approval = snapshot
        .approvals
        .iter()
        .find(|approval| family.contains(&approval.task_id))
        .context("Missing child approval")?;
    ensure!(
        approval.task_id == fixture["childTaskId"],
        "Approval is not owned by the delegated child"
    );
    ensure!(
        approval
            .actions()
            .iter()
            .map(|(decision, _)| *decision)
            .collect::<Vec<_>>()
            == vec!["approve", "session", "always", "deny"],
        "Native approval scopes were lost"
    );
    let _: Value = client
        .post(
            "/api/approvals",
            &json!({"id":approval.id,"allow":true,"decision":"session"}),
        )
        .await?;
    let decision_path = runtime.directory.path().join("decision.json");
    let deadline = Instant::now() + Duration::from_secs(5);
    while !decision_path.exists() {
        ensure!(Instant::now() < deadline, "Approval did not resolve");
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let decision: Value = serde_json::from_slice(&std::fs::read(decision_path)?)?;
    ensure!(
        decision["decision"] == "session",
        "Session decision was downgraded"
    );
    let _: Value = client
        .post(
            "/api/tasks/stop-agents",
            &json!({"id":id,"runToken":token,"childId":child.id}),
        )
        .await?;
    let stopped: Snapshot = serde_json::from_value(client.snapshot(Some(id)).await?)?;
    let parent = stopped
        .workspace
        .tasks
        .iter()
        .find(|task| task.id == id)
        .context("Parent disappeared")?;
    ensure!(
        parent
            .subagents
            .as_ref()
            .context("Missing stopped child")?
            .iter()
            .find(|agent| agent.id == child.id)
            .context("Stopped native child disappeared")?
            .status
            == "stopped",
        "Native child did not stop: {}",
        serde_json::to_string(&parent.subagents)?
    );
    ensure!(
        serde_json::to_value(&parent.messages)? == original,
        "Reading/stopping children changed parent history"
    );
    ensure!(
        client
            .post::<Value>("/api/tasks/stop-agents", &json!({"id":id,"runToken":token}))
            .await
            .is_err(),
        "Stale family token was accepted"
    );
    Ok(())
}

#[tokio::test]
#[ignore = "Requires the compiled Node runtime; run pnpm test:gpui:integration"]
async fn native_device_host_settings_preserve_revision_and_redact_tokens() -> Result<()> {
    let runtime = TestRuntime::start().await?;
    let client = &runtime.client;
    let initial: Value = client
        .request(Method::GET, "/api/device-hosts", None)
        .await?;
    let host = json!({"id":"private-host","name":"Private host","sshHost":"fixture.invalid","sshUser":"fixture","sshPort":22,"runtimeAddress":"http://fixture.invalid:4318","agentAccess":false,"token":"private-fixture-device-token"});
    let input = json!({"revision":initial["revision"],"enabled":true,"defaultHostId":"private-host","hosts":[host]});
    let saved: Value = client.post("/api/device-hosts", &input).await?;
    ensure!(
        saved["enabled"] == true && saved["hosts"][0]["hasToken"] == true,
        "Device host was not saved"
    );
    ensure!(
        saved["hosts"][0].get("token").is_none(),
        "Private device token escaped public settings"
    );
    ensure!(
        client
            .post::<Value>("/api/device-hosts", &input)
            .await
            .is_err(),
        "Stale host revision was accepted"
    );
    let mut renamed = saved.clone();
    renamed["hosts"][0]["name"] = json!("Renamed host");
    let renamed: Value = client.post("/api/device-hosts", &renamed).await?;
    ensure!(
        renamed["hosts"][0]["hasToken"] == true,
        "Renaming lost the saved pairing credential"
    );
    let mut changed = renamed.clone();
    changed["hosts"][0]["runtimeAddress"] = json!("http://other.invalid:4318");
    ensure!(
        client
            .post::<Value>("/api/device-hosts", &changed)
            .await
            .is_err(),
        "Changed destination reused another host's credential"
    );
    let read: Value = client
        .request(Method::GET, "/api/device-hosts", None)
        .await?;
    ensure!(read == renamed, "Rejected save changed host settings");
    let snapshot = client.snapshot(None).await?;
    ensure!(
        !snapshot
            .to_string()
            .contains("private-fixture-device-token"),
        "Device host token entered workspace sync"
    );
    let removed: Value = client
        .post(
            "/api/device-hosts",
            &json!({"revision":read["revision"],"enabled":false,"hosts":[]}),
        )
        .await?;
    ensure!(
        removed["hosts"] == json!([]) && removed.get("defaultHostId").is_none(),
        "Removing the preferred host left stale settings"
    );
    Ok(())
}

#[tokio::test]
#[ignore = "Requires the compiled Node runtime; run pnpm test:gpui:integration"]
async fn native_reviews_preserve_history_deduplicate_requests_and_reject_stale_approval()
-> Result<()> {
    let runtime = TestRuntime::start_entry("scripts/fixtures/gpui-task-revisions.mjs").await?;
    let client = &runtime.client;
    let fixture: Value = serde_json::from_slice(&std::fs::read(
        runtime.directory.path().join("fixture.json"),
    )?)?;
    let id = fixture["taskId"].as_str().context("Missing author")?;
    let initial: Snapshot = serde_json::from_value(client.snapshot(Some(id)).await?)?;
    let initial = initial
        .workspace
        .tasks
        .iter()
        .find(|task| task.id == id)
        .context("Missing author")?;
    let original = serde_json::to_value(&initial.messages)?;
    let request =
        json!({"taskId":id,"requestId":uuid::Uuid::new_v4().to_string(),"scope":"working"});
    let _: Value = client.post("/api/review/task/start", &request).await?;
    let deadline = Instant::now() + Duration::from_secs(10);
    let report = loop {
        let report: Value = client
            .post("/api/review/task/read", &json!({"taskId":id}))
            .await?;
        if report["reviews"][0]["status"] == "completed" {
            break report;
        }
        ensure!(
            Instant::now() < deadline,
            "Independent review did not complete"
        );
        tokio::time::sleep(Duration::from_millis(25)).await;
    };
    ensure!(
        report["current"] == true && report["approved"] == false,
        "Review was not current and unapproved"
    );
    let review = &report["reviews"][0];
    let review_id = &review["id"];
    let finding = &review["findings"][0];
    let duplicated: Value = client.post("/api/review/task/start", &request).await?;
    ensure!(
        duplicated["reviews"]
            .as_array()
            .context("Missing reviews")?
            .len()
            == 1
            && duplicated["reviews"][0]["id"] == *review_id,
        "Retry launched a duplicate reviewer"
    );
    let snapshot: Snapshot = serde_json::from_value(client.snapshot(Some(id)).await?)?;
    let author = snapshot
        .workspace
        .tasks
        .iter()
        .find(|task| task.id == id)
        .context("Author disappeared")?;
    ensure!(
        serde_json::to_value(&author.messages)? == original,
        "Independent review wrote into author history"
    );
    let reviewer = snapshot
        .workspace
        .tasks
        .iter()
        .find(|task| task.id == review["reviewerTaskId"])
        .context("Missing reviewer task")?;
    ensure!(
        reviewer.extra["harness"]["permission"] == "read-only",
        "Independent reviewer was not read-only"
    );
    ensure!(
        client
            .post::<Value>(
                "/api/review/task/approve",
                &json!({"taskId":id,"reviewId":review_id,"approved":true})
            )
            .await
            .is_err(),
        "Open findings allowed approval"
    );
    let _:Value=client.post("/api/review/task/finding",&json!({"taskId":id,"reviewId":review_id,"findingId":finding["id"],"status":"dismissed","resolution":"Expected fixture change"})).await?;
    let approved: Value = client
        .post(
            "/api/review/task/approve",
            &json!({"taskId":id,"reviewId":review_id,"approved":true}),
        )
        .await?;
    ensure!(
        approved["approved"] == true,
        "Reviewed changes were not approved"
    );
    std::fs::write(
        runtime.directory.path().join("project/hello.txt"),
        "Later file edit\n",
    )?;
    let moved: Value = client
        .post("/api/review/task/read", &json!({"taskId":id}))
        .await?;
    ensure!(
        moved["current"] == false && moved["approved"] == false,
        "File edits retained stale approval"
    );
    let delta: Value = client
        .post(
            "/api/review/task/changes",
            &json!({"taskId":id,"reviewId":review_id}),
        )
        .await?;
    let files: Vec<crate::model::ChangedFile> = serde_json::from_value(delta["files"].clone())?;
    ensure!(
        files
            .iter()
            .any(|file| file.path == "hello.txt" && file.after == "Later file edit\n"),
        "Saved review delta missed file changes"
    );
    ensure!(
        client
            .post::<Value>(
                "/api/review/task/approve",
                &json!({"taskId":id,"reviewId":review_id,"approved":true})
            )
            .await
            .is_err(),
        "Stale review was approved"
    );
    Ok(())
}

#[tokio::test]
#[ignore = "Starts an isolated Node runtime and deterministic ACP process"]
async fn native_acp_authentication_and_sessions() -> Result<()> {
    let runtime = TestRuntime::start_entry("scripts/fixtures/gpui-acp.mjs").await?;
    let client = &runtime.client;
    let id = "private-agent";
    let registry: Value = client.post("/api/agents/acp/registry", &json!({})).await?;
    ensure!(
        registry["agents"][0]["available"] == true && registry["agents"][1]["available"] == false,
        "Platform availability was lost"
    );
    let installed: Value = client
        .post("/api/agents/acp/install", &json!({"registryId":id}))
        .await?;
    ensure!(installed["id"] == id, "Wrong installation");
    let inspection: Value = client
        .post("/api/agents/acp/inspect", &json!({"id":id}))
        .await?;
    ensure!(
        inspection["authMethods"][1]["type"] == "terminal" && inspection["canLogout"] == true,
        "Auth capabilities were lost"
    );
    ensure!(
        !inspection.to_string().contains("PRIVATE_ACP_ROOT"),
        "Private launch environment leaked"
    );
    let _: Value = client
        .post(
            "/api/agents/acp/authenticate",
            &json!({"id":id,"methodId":"browser","background":true}),
        )
        .await?;
    let deadline = Instant::now() + Duration::from_secs(10);
    let callback = loop {
        let state: Value = client
            .post("/api/agents/acp/inspect", &json!({"id":id}))
            .await?;
        if state["authentication"]["status"] == "waiting"
            && state["authentication"]["urls"]
                .as_array()
                .is_some_and(|urls| !urls.is_empty())
        {
            break serde_json::from_slice::<Value>(&std::fs::read(
                runtime.directory.path().join("callback.json"),
            )?)?;
        }
        ensure!(
            Instant::now() < deadline,
            "Browser auth did not advertise a callback"
        );
        tokio::time::sleep(Duration::from_millis(25)).await;
    };
    ensure!(
        client
            .post::<Value>("/api/agents/acp/remove", &json!({"id":id}))
            .await
            .is_err(),
        "Active sign-in allowed removal"
    );
    ensure!(client.post::<Value>("/api/agents/acp/authenticate/callback", &json!({"id":id,"url":"http://127.0.0.1:4318/callback?code=fixture-code&state=wrong"})).await.is_err(),"Unadvertised callback accepted");
    let _: Value = client
        .post(
            "/api/agents/acp/authenticate/callback",
            &json!({"id":id,"url":callback["url"]}),
        )
        .await?;
    loop {
        let state: Value = client
            .post("/api/agents/acp/inspect", &json!({"id":id}))
            .await?;
        if state["authentication"]["status"] == "completed" {
            break;
        }
        ensure!(Instant::now() < deadline, "Auth did not complete");
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    let models: Value = client
        .post(
            "/api/agents/models",
            &json!({"provider":"acp","endpoint":"","model":"","acpInstallationId":id}),
        )
        .await?;
    ensure!(
        models["models"][0]["id"] == "private-model",
        "Connection probe missed the ACP model"
    );
    let sessions: Value = client
        .post("/api/agents/acp/sessions", &json!({"id":id}))
        .await?;
    let next: Value = client
        .post(
            "/api/agents/acp/sessions",
            &json!({"id":id,"cursor":sessions["nextCursor"]}),
        )
        .await?;
    ensure!(
        sessions["canDelete"] == true && next["sessions"][1]["sessionId"] == "last",
        "Session capabilities or paging were lost"
    );
    let _: Value = client
        .post(
            "/api/agents/acp/sessions/delete",
            &json!({"id":id,"sessionId":"first"}),
        )
        .await?;
    let sessions: Value = client
        .post("/api/agents/acp/sessions", &json!({"id":id}))
        .await?;
    ensure!(
        sessions["sessions"]
            .as_array()
            .is_some_and(|s| s.len() == 1),
        "Deleted session remains listed"
    );
    let _: Value = client
        .post("/api/agents/acp/logout", &json!({"id":id}))
        .await?;
    let terminal: Value = client
        .post(
            "/api/agents/acp/authenticate",
            &json!({"id":id,"methodId":"terminal","background":false}),
        )
        .await?;
    let terminal_id = terminal["terminal"]["id"]
        .as_str()
        .context("Missing sign-in terminal")?;
    let terminal_state: Value = client
        .post("/api/agents/acp/inspect", &json!({"id":id}))
        .await?;
    ensure!(
        terminal_state["terminal"]["id"] == terminal_id,
        "Sign-in terminal was not rediscovered"
    );
    let _: Value = client
        .post("/api/terminals/close", &json!({"id":terminal_id}))
        .await?;
    let _: Value = client
        .post(
            "/api/agents/acp/authenticate",
            &json!({"id":id,"methodId":"browser","background":true}),
        )
        .await?;
    let _: Value = client
        .post("/api/agents/acp/authenticate/cancel", &json!({"id":id}))
        .await?;
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        let state: Value = client
            .post("/api/agents/acp/inspect", &json!({"id":id}))
            .await?;
        if state["authentication"]["status"] == "failed" {
            break;
        }
        ensure!(Instant::now() < deadline, "Cancellation did not settle");
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    let _: Value = client
        .post("/api/agents/acp/remove", &json!({"id":id}))
        .await?;
    let list: Value = client.post("/api/agents/acp/list", &json!({})).await?;
    ensure!(
        list["installations"].as_array().is_some_and(Vec::is_empty),
        "Removed installation remains listed"
    );
    Ok(())
}

#[tokio::test]
#[ignore = "Starts two isolated Node runtimes for native fleet health"]
async fn native_fleet_counts_isolate_unavailable_computers() -> Result<()> {
    let first = TestRuntime::start_entry("scripts/fixtures/gpui-task-revisions.mjs").await?;
    let second = TestRuntime::start().await?;
    let baseline = crate::fleet::summary(&first.client).await?;
    let other = crate::fleet::summary(&second.client).await?;
    let repo = json!({"id":"fleet-repo","name":"Fleet fixture","path":first.directory.path(),"branch":"main"});
    let _: Value = first
        .client
        .request(
            Method::PATCH,
            "/api/workspace",
            Some(&serde_json::to_value(WorkspacePatch::create(
                "repositories",
                repo,
            )?)?),
        )
        .await?;
    for (id, status, archived) in [
        ("first-draft", "draft", false),
        ("second-draft", "draft", false),
        ("archived", "draft", false),
    ] {
        let task = json!({"id":id,"title":id,"repositoryId":"fleet-repo","agentId":"","status":status,"archived":archived,"createdAt":"2026-10-13T12:00:00Z","draft":"","messages":[],"files":[],"example":false});
        let _: Value = first
            .client
            .request(
                Method::PATCH,
                "/api/workspace",
                Some(&serde_json::to_value(WorkspacePatch::create(
                    "tasks", task,
                )?)?),
            )
            .await?;
    }
    let _: Value = first
        .client
        .post(
            "/api/tasks/lifecycle",
            &json!({"id":"archived","action":"archive"}),
        )
        .await?;
    let revoked = RuntimeClient::new(Connection {
        address: first.client.connection.address.clone(),
        token: "invalid-device-token".into(),
    })?;
    let entries = crate::fleet::read(vec![
        (
            "first".into(),
            "First".into(),
            first.client.connection.address.clone(),
            Ok(first.client.clone()),
        ),
        (
            "revoked".into(),
            "Revoked".into(),
            revoked.connection.address.clone(),
            Ok(revoked),
        ),
        (
            "second".into(),
            "Second".into(),
            second.client.connection.address.clone(),
            Ok(second.client.clone()),
        ),
    ])
    .await;
    ensure!(
        entries
            .iter()
            .map(|entry| entry.id.as_str())
            .collect::<Vec<_>>()
            == vec!["first", "revoked", "second"],
        "Parallel health reads changed computer order"
    );
    let first = entries[0]
        .result
        .as_ref()
        .map_err(|error| anyhow::anyhow!(error.clone()))?;
    ensure!(
        first.tasks == baseline.tasks + 2
            && first.projects == baseline.projects + 1
            && first.review == baseline.review
            && first.review > 0
            && first.failed == baseline.failed,
        "Fleet counts included archived tasks or omitted review tasks"
    );
    ensure!(
        entries[1].result.is_err(),
        "Revoked computer appeared online"
    );
    let second = entries[2]
        .result
        .as_ref()
        .map_err(|error| anyhow::anyhow!(error.clone()))?;
    ensure!(
        second.tasks == other.tasks && second.failed == other.failed,
        "Unavailable computer changed another computer's counts"
    );
    Ok(())
}

#[tokio::test]
#[ignore = "Starts isolated runtime and Chromium for native browser profile/session contracts"]
async fn native_browser_profiles_and_sessions_preserve_isolation() -> Result<()> {
    use crate::workbench::browser::{Catalog, Profile, Session};
    let runtime = TestRuntime::start_entry("scripts/fixtures/gpui-browser.mjs").await?;
    let fixture: Value = serde_json::from_slice(&std::fs::read(
        runtime.directory.path().join("fixture.json"),
    )?)?;
    let address = fixture["url"].as_str().context("Missing fixture URL")?;
    let mut catalog: Catalog = runtime
        .client
        .post("/api/previews/browser/profiles/read", &json!({}))
        .await?;
    catalog.profiles.push(Profile {
        id: "personal".into(),
        name: "Personal 🦀".into(),
    });
    catalog.validate()?;
    let saved: Catalog = runtime
        .client
        .post("/api/previews/browser/profiles/save", &json!(catalog))
        .await?;
    ensure!(
        saved.profiles == catalog.profiles,
        "Profile catalog did not round-trip"
    );
    let work = Session {
        id: "native-work".into(),
        task: "browser-task".into(),
        profile: "work".into(),
        address: format!("{address}/?set=work"),
        closing: false,
    };
    let other = Session {
        id: "native-default".into(),
        profile: "default".into(),
        address: address.to_owned(),
        ..work.clone()
    };
    let sibling = Session {
        id: "native-work-sibling".into(),
        address: address.to_owned(),
        ..work.clone()
    };
    async fn open(
        client: &RuntimeClient,
        session: &Session,
        navigate: bool,
    ) -> Result<
        tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
    > {
        let ticket: Value = client
            .post("/api/previews/browser/open", &session.input(navigate))
            .await?;
        ensure!(
            ticket["tabId"] == session.id && ticket["profileId"] == session.profile,
            "Ticket changed tab/profile identity"
        );
        let url = client.websocket_url(
            "/ws/browser",
            ticket["ticket"]
                .as_str()
                .context("Missing browser ticket")?,
        )?;
        let (socket, _) = connect_async(url.as_str()).await?;
        Ok(socket)
    }
    async fn state(
        socket: &mut tokio_tungstenite::WebSocketStream<
            tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
        >,
        title: &str,
        path: &str,
    ) -> Result<()> {
        tokio::time::timeout(Duration::from_secs(15), async {
            while let Some(message) = socket.next().await {
                if let Message::Text(text) = message? {
                    let value: Value = serde_json::from_str(&text)?;
                    if value["type"] == "error" {
                        anyhow::bail!("Browser error: {}", value["message"]);
                    }
                    if value["type"] == "state"
                        && value["title"] == title
                        && value["url"].as_str().is_some_and(|u| u.ends_with(path))
                    {
                        return Ok(());
                    }
                }
            }
            anyhow::bail!("Browser socket ended before the expected state")
        })
        .await??;
        Ok(())
    }
    let mut work_socket = open(&runtime.client, &work, true).await?;
    work_socket
        .send(Message::Text(
            json!({"type":"navigate","url":format!("{address}/second")})
                .to_string()
                .into(),
        ))
        .await?;
    state(&mut work_socket, "Profile work", "/second").await?;
    let mut default_socket = open(&runtime.client, &other, true).await?;
    state(&mut default_socket, "Profile empty", "/").await?;
    let mut sibling_socket = open(&runtime.client, &sibling, true).await?;
    state(&mut sibling_socket, "Profile work", "/").await?;
    work_socket.close(None).await?;
    let mut reconnect = open(&runtime.client, &work, false).await?;
    state(&mut reconnect, "Profile work", "/second").await?;
    let _: Value = runtime
        .client
        .post("/api/previews/browser/close", &work.input(false))
        .await?;
    sibling_socket
        .send(Message::Text(json!({"type":"status"}).to_string().into()))
        .await?;
    state(&mut sibling_socket, "Profile work", "/").await?;
    let _: Value = runtime
        .client
        .post("/api/previews/browser/close", &sibling.input(false))
        .await?;
    let _: Value = runtime
        .client
        .post("/api/previews/browser/close", &other.input(false))
        .await?;
    catalog.profiles.retain(|p| p.id != "work");
    let _: Catalog = runtime
        .client
        .post("/api/previews/browser/profiles/save", &json!(catalog))
        .await?;
    ensure!(
        runtime
            .client
            .post::<Value>("/api/previews/browser/open", &work.input(false))
            .await
            .is_err(),
        "Removed profile stayed selectable"
    );
    catalog.profiles.push(Profile {
        id: "work".into(),
        name: "Restored Work".into(),
    });
    let _: Catalog = runtime
        .client
        .post("/api/previews/browser/profiles/save", &json!(catalog))
        .await?;
    let mut restored = open(&runtime.client, &sibling, true).await?;
    state(&mut restored, "Profile work", "/").await?;
    let _: Value = runtime
        .client
        .post("/api/previews/browser/close", &sibling.input(false))
        .await?;
    Ok(())
}

#[tokio::test]
#[ignore = "Starts two isolated runtimes to verify source-scoped native task navigation"]
async fn native_fleet_task_connection_intent_matches_its_snapshot() -> Result<()> {
    use crate::service::{Command as ClientCommand, Event, Service};
    let first = TestRuntime::start().await?;
    let second = TestRuntime::start().await?;
    for (runtime, title) in [
        (&first, "First computer task"),
        (&second, "Second computer task"),
    ] {
        let task = json!({"id":"shared-id","title":title,"repositoryId":"","agentId":"","status":"draft","createdAt":"2026-10-13T12:00:00Z","draft":"","messages":[],"files":[],"example":false});
        let _: Value = runtime
            .client
            .request(
                Method::PATCH,
                "/api/workspace",
                Some(&serde_json::to_value(WorkspacePatch::create(
                    "tasks", task,
                )?)?),
            )
            .await?;
    }
    let storage = tempfile::tempdir()?;
    let (service, events) = Service::new(crate::storage::Storage {
        directory: storage.path().into(),
    })?;
    for (runtime, title, expected_generation) in [
        (&first, "First computer task", 1),
        (&second, "Second computer task", 2),
    ] {
        crate::drafts::Drafts::open(storage.path(), &runtime.client.connection)?
            .save("shared-id".into(), format!("Unsent {title}"))?;
        service.send(ClientCommand::Connect {
            connection: runtime.client.connection.clone(),
            open_task: Some("shared-id".into()),
        })?;
        tokio::time::timeout(Duration::from_secs(15), async {
            let mut connected = false;
            let mut drafts_loaded = false;
            loop {
                match events.recv().await? {
                    Event::Connected {
                        generation,
                        address,
                        open_task,
                    } if generation == expected_generation => {
                        ensure!(
                            address == runtime.client.connection.address
                                && open_task.as_deref() == Some("shared-id"),
                            "Task navigation intent changed computer or task"
                        );
                        connected = true;
                    }
                    Event::Drafts { generation, values } if generation == expected_generation => {
                        ensure!(
                            values.get("shared-id") == Some(&format!("Unsent {title}")),
                            "Recovered drafts crossed computer credentials"
                        );
                        drafts_loaded = true;
                    }
                    Event::Snapshot {
                        generation,
                        task,
                        snapshot,
                    } if generation == expected_generation => {
                        ensure!(
                            connected && drafts_loaded,
                            "Snapshot arrived before connection intent or recovered drafts"
                        );
                        ensure!(
                            task.is_none()
                                && snapshot
                                    .workspace
                                    .tasks
                                    .iter()
                                    .any(|task| task.id == "shared-id" && task.title == title),
                            "A colliding task ID selected the wrong computer"
                        );
                        return Ok::<(), anyhow::Error>(());
                    }
                    _ => {}
                }
            }
        })
        .await??;
        let summary = crate::fleet::summary(&runtime.client).await?;
        ensure!(
            summary
                .task_entries
                .iter()
                .any(|task| task.id == "shared-id" && task.title == title),
            "Fleet omitted task navigation entries"
        );
    }
    service.send(ClientCommand::Disconnect)?;
    drop(service);
    Ok(())
}
