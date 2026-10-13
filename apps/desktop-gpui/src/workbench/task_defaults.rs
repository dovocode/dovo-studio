use crate::model::{Agent, Permission, Provider, Repository, Snapshot};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Clone, Copy, Default, Deserialize, Serialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub(super) enum Execution {
    #[default]
    Main,
    Worktree,
}
#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
enum Submodules {
    None,
    Direct,
    Recursive,
}
#[derive(Deserialize, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CheckoutDefaults {
    #[serde(default)]
    execution: Execution,
    #[serde(default = "from_origin")]
    worktree_from_origin: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    setup_command: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    submodules: Option<Submodules>,
}
fn from_origin() -> bool {
    true
}
impl CheckoutDefaults {
    pub(crate) fn fields(
        mut self,
        folder: bool,
        override_worktree: Option<bool>,
    ) -> anyhow::Result<Value> {
        if folder {
            self.execution = Execution::Main;
            self.worktree_from_origin = false;
            self.setup_command = None;
            self.submodules = None;
        } else if let Some(worktree) = override_worktree {
            self.execution = if worktree {
                Execution::Worktree
            } else {
                Execution::Main
            };
        }
        Ok(serde_json::to_value(self)?)
    }
    pub(super) fn execution(&self, folder: bool, override_worktree: Option<bool>) -> Execution {
        if folder {
            Execution::Main
        } else {
            override_worktree.map_or(self.execution, |worktree| {
                if worktree {
                    Execution::Worktree
                } else {
                    Execution::Main
                }
            })
        }
    }
}
pub(crate) fn resolve(
    snapshot: &Snapshot,
    repository: &Repository,
) -> anyhow::Result<CheckoutDefaults> {
    Ok(serde_json::from_value(merged_defaults(
        snapshot, repository,
    ))?)
}
pub(super) fn scoped_values<'a>(
    snapshot: &'a Snapshot,
    repository: &'a Repository,
) -> Vec<&'a Value> {
    let mut result = Vec::new();
    if let Some(runtime) = snapshot.extra.get("defaults")
        && let Some(scoped) = runtime.get("scopedSettings")
    {
        let shared = |key: &str| {
            scoped
                .get("shared")
                .and_then(Value::as_array)
                .and_then(|entries| {
                    entries
                        .iter()
                        .find(|e| e.get("key").and_then(Value::as_str) == Some(key))
                })
                .and_then(|e| e.get("value"))
        };
        if let Some(value) = shared("global") {
            result.push(value);
        }
        if let Some(value) = scoped.get("environment") {
            result.push(value);
        }
        if let Some(identity) = repository.extra.get("gitIdentity").and_then(Value::as_str)
            && let Some(value) = shared(&format!("project:{identity}"))
        {
            result.push(value);
        }
    }
    result
}
fn merged_defaults(snapshot: &Snapshot, repository: &Repository) -> Value {
    let mut result = json!({});
    let mut merge = |value: Option<&Value>| {
        if let Some(fields) = value.and_then(Value::as_object) {
            for (key, value) in fields {
                result[key] = value.clone();
            }
        }
    };
    let runtime = snapshot.extra.get("defaults");
    if runtime.is_some_and(|value| value.get("scopedSettings").is_some()) {
        for value in scoped_values(snapshot, repository) {
            merge(value.get("taskDefaults"));
        }
    } else {
        merge(runtime);
    }
    merge(repository.extra.get("taskDefaults"));
    result
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct Harness {
    provider: Provider,
    model: String,
    instructions: String,
    permission: Permission,
    endpoint: String,
    #[serde(flatten)]
    extra: serde_json::Map<String, Value>,
}
fn provider_permission(provider: Provider, permission: Permission) -> Permission {
    match (provider, permission) {
        (Provider::Cursor, Permission::Ask | Permission::WorkspaceWrite) => Permission::ReadOnly,
        (Provider::Hermes | Provider::Grok | Provider::Muse, Permission::ReadOnly) => {
            Permission::Ask
        }
        _ => permission,
    }
}
pub(crate) fn task_fields(
    snapshot: &Snapshot,
    repository: &Repository,
    override_worktree: Option<bool>,
    agent: Option<&Agent>,
) -> anyhow::Result<Value> {
    let defaults = merged_defaults(snapshot, repository);
    let mut fields =
        resolve(snapshot, repository)?.fields(repository.kind.is_some(), override_worktree)?;
    let mut harness = if let Some(agent) = agent {
        let mut value = serde_json::to_value(agent)?;
        if let Some(fields) = value.as_object_mut() {
            for field in ["id", "name", "icon", "globalPreset", "serverOverride"] {
                fields.remove(field);
            }
        }
        value
    } else {
        let mut value=defaults.get("harness").cloned().unwrap_or(json!({"provider":"codex","model":"","reasoning":"","instructions":"","permission":"full-access","endpoint":""}));
        value["permission"] = defaults
            .get("permission")
            .cloned()
            .unwrap_or(json!("full-access"));
        value
    };
    let mut checked: Harness = serde_json::from_value(harness.take())?;
    checked.permission = provider_permission(checked.provider, checked.permission);
    fields["harness"] = serde_json::to_value(checked)?;
    if let Some(agent) = agent {
        fields["agentName"] = json!(agent.name);
        if let Some(icon) = agent.extra.get("icon") {
            fields["agentIcon"] = icon.clone();
        }
    }
    Ok(fields)
}

#[cfg(test)]
mod tests {
    use super::{Execution, resolve};
    use crate::model::{Repository, Snapshot};
    use serde_json::json;
    #[test]
    fn scope_precedence_and_folder_constraints_match_task_checkout_contract() {
        let snapshot:Snapshot=serde_json::from_value(json!({"revision":1,"workspace":{"version":1,"agents":[],"repositories":[],"tasks":[],"automations":[],"runtimeAddress":""},"approvals":[],"terminals":[],"runs":[],"devices":[],"pendingDevices":[],"owner":true,"defaults":{"scopedSettings":{"environment":{"taskDefaults":{"execution":"main","setupCommand":"computer"}},"shared":[{"key":"global","value":{"taskDefaults":{"execution":"worktree","worktreeFromOrigin":false,"submodules":"recursive"}}},{"key":"project:forge/team/repo","value":{"taskDefaults":{"setupCommand":"shared-project"}}}]}}})).unwrap();
        let mut repo:Repository=serde_json::from_value(json!({"id":"repo","name":"Repo","path":"/project","branch":"main","gitIdentity":"forge/team/repo","taskDefaults":{"worktreeFromOrigin":true}})).unwrap();
        let defaults = resolve(&snapshot, &repo).unwrap();
        assert_eq!(defaults.execution(false, None), Execution::Main);
        assert_eq!(
            defaults.fields(false, Some(true)).unwrap(),
            json!({"execution":"worktree","worktreeFromOrigin":true,"setupCommand":"shared-project","submodules":"recursive"})
        );
        repo.kind = Some("folder".into());
        assert_eq!(
            resolve(&snapshot, &repo)
                .unwrap()
                .fields(true, Some(true))
                .unwrap(),
            json!({"execution":"main","worktreeFromOrigin":false})
        );
    }
}
