use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub revision: u64,
    pub runtime_instance_id: Option<String>,
    pub runtime_host: Option<String>,
    pub protocol_version: Option<u64>,
    pub workspace: Workspace,
    pub approvals: Vec<Approval>,
    #[serde(default)]
    pub questions: Vec<Question>,
    pub terminals: Vec<Terminal>,
    pub runs: Vec<JobRun>,
    pub devices: Vec<Device>,
    pub pending_devices: Vec<PendingDevice>,
    pub owner: bool,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

impl Snapshot {
    pub fn validate(&self) -> anyhow::Result<()> {
        anyhow::ensure!(
            self.protocol_version.unwrap_or(2) == 2,
            "This runtime uses an incompatible protocol. Update Dovo Studio."
        );
        for task in &self.workspace.tasks {
            anyhow::ensure!(!task.id.is_empty(), "Runtime returned a task without an ID");
            let mut ids = std::collections::HashSet::new();
            anyhow::ensure!(
                task.messages.iter().all(|message| ids.insert(&message.id)),
                "Runtime returned duplicate conversation messages"
            );
        }
        Ok(())
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Workspace {
    pub version: u64,
    pub agents: Vec<Agent>,
    pub repositories: Vec<Repository>,
    pub tasks: Vec<Task>,
    pub automations: Vec<Automation>,
    pub runtime_address: String,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct Repository {
    pub id: String,
    pub name: String,
    pub path: String,
    pub branch: String,
    pub kind: Option<String>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "kebab-case")]
pub enum Permission {
    Ask,
    ReadOnly,
    WorkspaceWrite,
    Auto,
    FullAccess,
}

#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Provider {
    Codex,
    Opencode,
    Claude,
    Hermes,
    Copilot,
    Grok,
    Muse,
    Cursor,
    Acp,
}

impl Provider {
    pub const ALL: [Self; 9] = [
        Self::Codex,
        Self::Opencode,
        Self::Claude,
        Self::Hermes,
        Self::Copilot,
        Self::Grok,
        Self::Muse,
        Self::Cursor,
        Self::Acp,
    ];
    pub fn name(self) -> &'static str {
        match self {
            Self::Codex => "codex",
            Self::Opencode => "opencode",
            Self::Claude => "claude",
            Self::Hermes => "hermes",
            Self::Copilot => "copilot",
            Self::Grok => "grok",
            Self::Muse => "muse",
            Self::Cursor => "cursor",
            Self::Acp => "acp",
        }
    }
}

#[derive(Clone, Deserialize, Serialize)]
pub struct Agent {
    pub id: String,
    pub name: String,
    pub provider: Provider,
    pub model: String,
    pub instructions: String,
    pub permission: Permission,
    pub endpoint: String,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum TaskStatus {
    Draft,
    Running,
    Review,
    Done,
    Failed,
    Cancelled,
}
impl TaskStatus {
    pub fn label(self) -> &'static str {
        match self {
            Self::Draft => "Draft",
            Self::Running => "Running",
            Self::Review => "Review",
            Self::Done => "Done",
            Self::Failed => "Failed",
            Self::Cancelled => "Stopped",
        }
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    pub repository_id: String,
    pub agent_id: String,
    pub status: TaskStatus,
    pub created_at: String,
    pub messages: Vec<ChatMessage>,
    pub files: Vec<ChangedFile>,
    pub draft: String,
    #[serde(default)]
    pub draft_attachments: Vec<Attachment>,
    pub example: bool,
    pub active_run_id: Option<String>,
    pub history_before: Option<String>,
    pub history_revision: Option<u64>,
    #[serde(default)]
    pub archived: bool,
    pub archived_at: Option<String>,
    pub pinned: Option<bool>,
    #[serde(default)]
    pub queue: Vec<QueuedMessage>,
    #[serde(default)]
    pub queue_paused: bool,
    #[serde(default)]
    pub turns: Vec<Turn>,
    #[serde(default)]
    pub scheduled_messages: Vec<ScheduledMessage>,
    #[serde(default)]
    pub side_chats: Vec<SideChat>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delegation: Option<Delegation>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subagents: Option<Vec<Subagent>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub native_todos: Option<Vec<NativeTodo>>,
}
impl Task {
    pub fn is_archived(&self) -> bool {
        self.archived || self.archived_at.is_some()
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationPage {
    pub messages: Vec<ChatMessage>,
    pub turns: Vec<Turn>,
    pub before: Option<String>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Turn {
    pub id: String,
    pub assistant_id: String,
    pub provider: Provider,
    pub model: String,
    pub status: String,
    pub started_at: String,
    pub error: Option<String>,
    pub tokens: Option<f64>,
    pub estimated_cost_usd: Option<f64>,
    pub checkpoint: Option<TurnCheckpoint>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnCheckpoint {
    #[serde(default)]
    pub linked: Vec<LinkedCheckpoint>,
    #[serde(flatten)]
    pub changes: CheckpointChanges,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkedCheckpoint {
    pub checkout_id: String,
    pub repository_id: String,
    pub repository_name: Option<String>,
    pub directory: String,
    pub branch: Option<String>,
    #[serde(flatten)]
    pub changes: CheckpointChanges,
}
#[derive(Clone, Deserialize, Serialize)]
pub struct CheckpointChanges {
    pub before: String,
    pub after: Option<String>,
    pub files: Vec<ChangedFile>,
    pub omitted: Vec<String>,
    pub error: Option<String>,
    pub undone: Option<CheckpointUndo>,
}
#[derive(Clone, Deserialize, Serialize)]
pub struct CheckpointUndo {
    pub at: String,
    pub backup: String,
}
#[derive(Clone, Deserialize, Serialize)]
pub struct ScheduledMessage {
    pub id: String,
    pub text: String,
    pub at: String,
    pub failed: Option<String>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SideChat {
    pub id: String,
    pub title: String,
    pub draft: String,
    pub created_at: String,
    pub messages: Vec<SideMessage>,
}
#[derive(Clone, Deserialize, Serialize)]
pub struct SideMessage {
    pub id: String,
    pub question: String,
    pub answer: Option<String>,
    pub error: Option<String>,
    pub status: String,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct QueuedMessage {
    pub id: String,
    pub text: String,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}
#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    User,
    Assistant,
}
#[derive(Clone, Deserialize, Serialize)]
pub struct ChatMessage {
    pub id: String,
    pub role: Role,
    pub text: String,
    #[serde(default)]
    pub attachments: Vec<Attachment>,
    #[serde(default)]
    pub bookmarked: bool,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    pub path: String,
    pub before: String,
    pub after: String,
    pub viewed: bool,
    pub disk_contents: Option<String>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Approval {
    pub id: String,
    pub task_id: String,
    pub title: String,
    pub detail: String,
    #[serde(
        default,
        deserialize_with = "present_nullable",
        skip_serializing_if = "Option::is_none"
    )]
    pub remember_rule: Option<Option<String>>,
    pub scopes: Option<ApprovalScopes>,
    pub created_at: String,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Question {
    pub id: String,
    pub task_id: String,
    pub prompt: QuestionPrompt,
    pub created_at: String,
}
#[derive(Clone, Deserialize, Serialize)]
pub struct QuestionPrompt {
    pub title: String,
    pub questions: Vec<QuestionField>,
    pub blocking: Option<bool>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QuestionField {
    pub id: String,
    pub header: String,
    pub question: String,
    #[serde(default)]
    pub options: Vec<QuestionOption>,
    #[serde(default)]
    pub multiple: bool,
    #[serde(default = "yes")]
    pub custom: bool,
    #[serde(default = "yes")]
    pub required: bool,
    #[serde(default)]
    pub secret: bool,
    pub input_type: Option<String>,
}
fn yes() -> bool {
    true
}
#[derive(Clone, Deserialize, Serialize)]
pub struct QuestionOption {
    pub value: String,
    pub label: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Terminal {
    pub id: String,
    pub task_id: String,
    pub title: String,
    pub exited: bool,
    pub exit_code: Option<i32>,
    pub checkout_id: Option<String>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub revoked_at: Option<String>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingDevice {
    pub id: String,
    pub name: String,
    pub expires_at: String,
}
#[derive(Clone, Deserialize, Serialize)]
pub struct Automation {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub enabled: Option<bool>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JobRun {
    pub id: String,
    pub automation_id: String,
    pub status: String,
    pub error: Option<String>,
    pub created_at: String,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

#[derive(Serialize)]
pub struct WorkspacePatch {
    pub collection: &'static str,
    pub id: String,
    pub changes: std::collections::BTreeMap<String, FieldChange>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub create: Option<Value>,
}
#[derive(Serialize)]
pub struct FieldChange {
    pub before: Value,
    pub after: Value,
}
impl WorkspacePatch {
    pub fn create(collection: &'static str, value: Value) -> anyhow::Result<Self> {
        let id = value
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow::anyhow!("Entity ID is required"))?
            .to_owned();
        Ok(Self {
            collection,
            id,
            changes: Default::default(),
            create: Some(value),
        })
    }
    pub fn update(
        collection: &'static str,
        id: String,
        field: &str,
        before: Value,
        after: Value,
    ) -> Self {
        Self {
            collection,
            id,
            changes: [(field.to_owned(), FieldChange { before, after })].into(),
            create: None,
        }
    }
}

#[derive(Clone, Deserialize, Serialize)]
pub struct ActivityEvent {
    pub id: String,
    pub time: String,
    pub kind: String,
    pub scope: String,
    pub summary: String,
    pub payload: String,
}

#[derive(Clone, Deserialize, Serialize)]
pub struct Attachment {
    pub id: String,
    pub name: String,
    pub mime: String,
    pub size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageInput {
    pub id: String,
    pub message_id: String,
    pub text: String,
    pub attachment_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub run_id: Option<String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullDetail {
    pub stack: Option<PullStack>,
    pub capabilities: Option<PullCapabilities>,
    pub pull: PullInfo,
    pub comments: Vec<PullComment>,
    pub files: Vec<PullFile>,
    pub checks: Vec<PullCheck>,
    pub warnings: Vec<String>,
    pub refresh_error: Option<String>,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullStack {
    pub root_number: u64,
    pub position: u64,
    pub size: u64,
    pub parent_number: Option<u64>,
    pub complete: bool,
    pub members: Vec<PullStackMember>,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullStackMember {
    pub number: u64,
    pub title: String,
    pub url: String,
    pub head: String,
    pub base: String,
    pub draft: bool,
    pub parent_number: Option<u64>,
    pub depth: u64,
}
#[derive(Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PullCapabilities {
    pub actions: Vec<String>,
    pub review_decisions: Vec<String>,
    pub merge_methods: Vec<String>,
    pub inline_range: Option<bool>,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PullInfo {
    pub number: u64,
    pub title: String,
    pub body: String,
    pub state: String,
    pub author: String,
    pub head: String,
    pub base: String,
    pub head_sha: String,
    pub head_clone_url: Option<String>,
}
#[derive(Clone, Deserialize)]
pub struct PullComment {
    pub kind: String,
    #[serde(rename = "threadId")]
    pub thread_id: Option<String>,
    pub resolved: Option<bool>,
    #[serde(rename = "canResolve")]
    pub can_resolve: Option<bool>,
    pub id: String,
    pub author: String,
    pub body: String,
    pub date: String,
    pub path: Option<String>,
    pub state: Option<String>,
    pub line: Option<f64>,
    pub diff: Option<String>,
    pub outdated: Option<bool>,
    pub commit_id: Option<String>,
    pub url: String,
}
#[derive(Clone, Deserialize)]
pub struct PullFile {
    pub path: String,
    pub status: String,
    pub patch: Option<String>,
    pub additions: Option<u64>,
    pub deletions: Option<u64>,
}
#[derive(Clone, Deserialize)]
pub struct PullCheck {
    pub name: String,
    pub status: String,
    pub summary: Option<String>,
    pub details: Option<String>,
    pub url: Option<String>,
}

// Preserve missing versus explicit null for older runtimes' remembered command rules.
fn present_nullable<'de, D: serde::Deserializer<'de>>(
    d: D,
) -> Result<Option<Option<String>>, D::Error> {
    Option::<String>::deserialize(d).map(Some)
}
#[derive(Clone, Deserialize, Serialize)]
pub struct ApprovalScopes {
    pub session: bool,
    pub always: bool,
}
impl Approval {
    pub fn actions(&self) -> Vec<(&'static str, &'static str)> {
        let title = self.title.to_lowercase();
        let remember = match self.remember_rule.as_ref() {
            Some(Some(rule)) if rule == "web" => Some("Always allow web in this project"),
            Some(Some(rule)) if rule == "command" => Some("Always allow in this project"),
            None if ["command", "bash", "shell"]
                .iter()
                .any(|word| title.contains(word)) =>
            {
                Some("Always allow in this project")
            }
            _ => None,
        };
        let mut actions = vec![("approve", "Allow once")];
        if self.scopes.as_ref().is_some_and(|scopes| scopes.session) {
            actions.push(("session", "Allow for session"));
        }
        if self.scopes.as_ref().is_some_and(|scopes| scopes.always) || remember.is_some() {
            actions.push(("always", remember.unwrap_or("Always allow")));
        }
        actions.push(("deny", "Deny"));
        actions
    }
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Delegation {
    pub parent_task_id: String,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Subagent {
    pub id: String,
    pub provider: String,
    pub name: String,
    pub status: String,
    pub started_at: String,
    pub updated_at: String,
    pub source: Option<String>,
    pub task_id: Option<String>,
    pub session_id: Option<String>,
    pub session_live: Option<bool>,
    pub completion_id: Option<String>,
    pub finished_at: Option<String>,
    pub prompt: Option<String>,
    pub result: Option<String>,
    pub activity: Option<String>,
    pub model: Option<String>,
    pub reasoning: Option<String>,
    pub tokens: Option<f64>,
    pub duration_ms: Option<f64>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}
impl Subagent {
    pub fn native_working(&self) -> bool {
        self.source.as_deref() != Some("dovo")
            && self.session_live == Some(true)
            && self.finished_at.is_none()
            && matches!(self.status.as_str(), "working" | "unknown")
    }
}
#[derive(Clone, Deserialize, Serialize)]
pub struct NativeTodo {
    pub text: String,
    pub status: TodoStatus,
}
#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum TodoStatus {
    Pending,
    InProgress,
    Completed,
}
#[derive(Clone, Deserialize)]
pub struct NativeThreadEntry {
    pub id: String,
    pub role: String,
    pub text: String,
    pub label: Option<String>,
}
#[derive(Deserialize)]
pub struct NativeThreadPage {
    pub entries: Vec<NativeThreadEntry>,
    pub before: Option<String>,
    pub notice: Option<String>,
}

#[cfg(test)]
mod approval_tests {
    use super::*;
    use core::prelude::v1::test;
    use serde_json::json;
    fn approval(rule: Option<Value>, scopes: Option<Value>) -> Approval {
        let mut value = json!({"id":"approval","taskId":"task","title":"Run shell command","detail":"test","createdAt":"now"});
        if let Some(rule) = rule {
            value["rememberRule"] = rule;
        }
        if let Some(scopes) = scopes {
            value["scopes"] = scopes;
        }
        serde_json::from_value(value).unwrap()
    }
    #[test]
    fn scopes_and_remember_labels_match_protocol_with_legacy_fallback() {
        assert_eq!(
            approval(Some(Value::Null), None).actions(),
            vec![("approve", "Allow once"), ("deny", "Deny")]
        );
        assert_eq!(
            approval(None, None).actions(),
            vec![
                ("approve", "Allow once"),
                ("always", "Always allow in this project"),
                ("deny", "Deny")
            ]
        );
        assert_eq!(
            approval(
                Some(Value::Null),
                Some(json!({"session":true,"always":true}))
            )
            .actions(),
            vec![
                ("approve", "Allow once"),
                ("session", "Allow for session"),
                ("always", "Always allow"),
                ("deny", "Deny")
            ]
        );
        assert_eq!(
            approval(Some(json!("web")), None).actions()[1],
            ("always", "Always allow web in this project")
        );
        assert!(
            serde_json::to_value(approval(None, None))
                .unwrap()
                .get("rememberRule")
                .is_none()
        );
        assert_eq!(
            serde_json::to_value(approval(Some(Value::Null), None)).unwrap()["rememberRule"],
            Value::Null
        );
    }
}
