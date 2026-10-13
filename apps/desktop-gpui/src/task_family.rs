use crate::model::{Subagent, Task};
use serde_json::json;
use std::collections::{HashMap, HashSet};

pub fn ids(tasks: &[Task], root: &str) -> HashSet<String> {
    let mut children: HashMap<&str, Vec<&str>> = HashMap::new();
    for task in tasks {
        if let Some(parent) = &task.delegation {
            children
                .entry(&parent.parent_task_id)
                .or_default()
                .push(&task.id);
        }
    }
    let mut found = HashSet::new();
    let mut pending = vec![root];
    while let Some(id) = pending.pop() {
        if found.insert(id.to_owned()) {
            pending.extend(children.get(id).into_iter().flatten().copied());
        }
    }
    found
}

pub fn agents<'a>(tasks: &'a [Task], root: &str) -> Vec<(&'a Task, &'a Subagent)> {
    let family = ids(tasks, root);
    let mut records = Vec::new();
    let mut keys = HashSet::new();
    for owner in tasks.iter().filter(|task| family.contains(&task.id)) {
        for agent in owner.subagents.iter().flatten() {
            let key = if agent.source.as_deref() == Some("dovo") {
                let child = agent.task_id.as_deref().unwrap_or(&agent.id);
                if !family.contains(child) || !tasks.iter().any(|task| task.id == child) {
                    continue;
                }
                format!("dovo:{child}")
            } else {
                format!("{}:{}:{}", owner.id, agent.provider, agent.id)
            };
            if keys.insert(key) {
                records.push((owner, agent));
            }
        }
    }
    records
}

/// Match taskFamilyRunToken, including null for absent arrays and array fields.
/// Runtime-created IDs are canonical UUIDs, whose localeCompare order equals lexical order.
/// Reject imported IDs outside that domain rather than guess JavaScript collation.
pub fn run_token(tasks: &[Task], root: &str) -> anyhow::Result<String> {
    let family = ids(tasks, root);
    let mut tasks: Vec<_> = tasks
        .iter()
        .filter(|task| family.contains(&task.id))
        .collect();
    for task in &tasks {
        anyhow::ensure!(
            uuid::Uuid::parse_str(&task.id).is_ok_and(|id| id.to_string() == task.id),
            "Stopping this imported task family requires a client with runtime ID collation support"
        );
    }
    tasks.sort_by(|a, b| a.id.cmp(&b.id));
    let token = json!(
        tasks
            .iter()
            .map(|task| {
                let agents = task.subagents.as_ref().map(|agents| {
                    agents
                        .iter()
                        .filter(|agent| agent.source.as_deref() != Some("dovo"))
                        .map(|agent| {
                            json!([
                                agent.provider,
                                agent.session_id,
                                agent.id,
                                agent.started_at,
                                agent.status,
                                agent.session_live,
                                agent.completion_id
                            ])
                        })
                        .collect::<Vec<_>>()
                });
                json!([task.id, task.active_run_id, task.status, agents])
            })
            .collect::<Vec<_>>()
    )
    .to_string();
    anyhow::ensure!(
        token.len() <= 100_000,
        "Task family is too large to stop in one request"
    );
    Ok(token)
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    pub fn task(id: &str, parent: Option<&str>, agents: Option<serde_json::Value>) -> Task {
        let mut value = json!({"id":id,"title":"Test","repositoryId":"repo","agentId":"agent","status":"review","createdAt":"now","messages":[],"files":[],"draft":"","example":false});
        if let Some(parent) = parent {
            value["delegation"] = json!({"parentTaskId":parent});
        }
        if let Some(agents) = agents {
            value["subagents"] = agents;
        }
        serde_json::from_value(value).unwrap()
    }
    #[test]
    fn family_handles_nested_and_cyclic_delegation() {
        let tasks = vec![
            task("a", Some("c"), None),
            task("b", Some("a"), None),
            task("c", Some("b"), None),
            task("unrelated", None, None),
        ];
        assert_eq!(
            ids(&tasks, "a"),
            ["a".into(), "b".into(), "c".into()].into()
        );
    }
    #[test]
    fn stop_token_preserves_absent_arrays_and_native_optional_fields() {
        let first = "00000000-0000-4000-8000-000000000001";
        let second = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        let tasks = vec![
            task(
                second,
                Some(first),
                Some(json!([
                    {"id":"native","provider":"codex","name":"Child","status":"unknown","startedAt":"now","updatedAt":"now","sessionLive":true},
                    {"id":"delegated","source":"dovo","provider":"codex","name":"Dovo child","status":"working","startedAt":"now","updatedAt":"now"}
                ])),
            ),
            task(first, None, None),
        ];
        assert_eq!(
            run_token(&tasks, first).unwrap(),
            json!([
                [first, null, "review", null],
                [
                    second,
                    null,
                    "review",
                    [["codex", null, "native", "now", "unknown", true, null]]
                ]
            ])
            .to_string()
        );
        assert!(run_token(&[task("Imported Ä", None, None)], "Imported Ä").is_err());
    }
}
