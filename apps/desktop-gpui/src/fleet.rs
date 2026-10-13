use crate::{
    connection::RuntimeClient,
    model::{Snapshot, TaskStatus},
};
use anyhow::{Context, Result};
use futures_util::{StreamExt, stream};
use std::time::Duration;

#[derive(Clone)]
pub struct Entry {
    pub id: String,
    pub name: String,
    pub address: String,
    pub result: Result<Summary, String>,
}
#[derive(Clone)]
pub struct TaskEntry {
    pub id: String,
    pub title: String,
    pub project: String,
    pub status: TaskStatus,
}
#[derive(Clone)]
pub struct Summary {
    pub projects: usize,
    pub tasks: usize,
    pub running: usize,
    pub review: usize,
    pub failed: usize,
    pub approvals: usize,
    pub questions: usize,
    pub task_entries: Vec<TaskEntry>,
}
pub async fn summary(client: &RuntimeClient) -> Result<Summary> {
    let value = tokio::time::timeout(Duration::from_secs(10), client.snapshot(None))
        .await
        .context("Computer did not respond within 10 seconds")??;
    let snapshot: Snapshot = serde_json::from_value(value)?;
    snapshot.validate()?;
    let mut tasks: Vec<_> = snapshot
        .workspace
        .tasks
        .iter()
        .filter(|task| !task.is_archived())
        .collect();
    tasks.sort_by(|a, b| {
        b.pinned
            .cmp(&a.pinned)
            .then_with(|| b.created_at.cmp(&a.created_at))
    });
    let task_entries = tasks
        .iter()
        .map(|task| TaskEntry {
            id: task.id.clone(),
            title: task.title.clone(),
            status: task.status,
            project: snapshot
                .workspace
                .repositories
                .iter()
                .find(|repo| repo.id == task.repository_id)
                .map(|repo| repo.name.clone())
                .unwrap_or_else(|| "General".into()),
        })
        .collect();
    Ok(Summary {
        task_entries,
        projects: snapshot
            .workspace
            .repositories
            .iter()
            .filter(|repo| repo.kind.as_deref() != Some("scratch"))
            .count(),
        tasks: tasks.len(),
        running: tasks
            .iter()
            .filter(|task| task.status == TaskStatus::Running)
            .count(),
        review: tasks
            .iter()
            .filter(|task| task.status == TaskStatus::Review)
            .count(),
        failed: tasks
            .iter()
            .filter(|task| task.status == TaskStatus::Failed)
            .count(),
        approvals: snapshot.approvals.len(),
        questions: snapshot.questions.len(),
    })
}
pub async fn read(sources: Vec<(String, String, String, Result<RuntimeClient>)>) -> Vec<Entry> {
    let mut entries = stream::iter(sources.into_iter().enumerate().map(
        |(order, (id, name, address, client))| async move {
            let result = match client {
                Ok(client) => summary(&client).await,
                Err(error) => Err(error),
            }
            .map_err(|error| error.to_string());
            (
                order,
                Entry {
                    id,
                    name,
                    address,
                    result,
                },
            )
        },
    ))
    .buffer_unordered(4)
    .collect::<Vec<_>>()
    .await;
    entries.sort_by_key(|(order, _)| *order);
    entries.into_iter().map(|(_, entry)| entry).collect()
}
