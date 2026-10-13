use crate::model::Snapshot;
use anyhow::{Context, Result, ensure};
use serde_json::{Value, json};
use std::collections::BTreeMap;

#[derive(Default)]
pub struct Replica {
    pub epoch: Option<String>,
    pub sequence: Option<u64>,
    pub value: Option<Value>,
    pub activity: BTreeMap<String, Value>,
}
impl Replica {
    pub fn apply(&mut self, frame: Value) -> Result<Option<Snapshot>> {
        match frame.get("type").and_then(Value::as_str) {
            Some("snapshot") => {
                let value = frame
                    .get("snapshot")
                    .context("Missing sync snapshot")?
                    .clone();
                let snapshot: Snapshot = serde_json::from_value(value.clone())?;
                snapshot.validate()?;
                self.epoch = Some(string(&frame, "epoch")?.to_owned());
                self.sequence = Some(number(&frame, "sequence")?);
                self.value = Some(value);
                Ok(Some(snapshot))
            }
            Some("delta") => {
                ensure!(
                    self.epoch.as_deref() == Some(string(&frame, "epoch")?),
                    "Runtime restarted; reconnecting"
                );
                ensure!(
                    self.sequence == Some(number(&frame, "base")?),
                    "Missing sync baseline; reconnecting"
                );
                let sequence = number(&frame, "sequence")?;
                ensure!(
                    sequence > self.sequence.unwrap_or_default(),
                    "Out of order sync frame"
                );
                let mut value = self.value.clone().context("Missing snapshot baseline")?;
                apply_delta(&mut value, frame.get("delta").context("Missing delta")?)?;
                let snapshot: Snapshot = serde_json::from_value(value.clone())?;
                snapshot.validate()?;
                self.value = Some(value);
                self.sequence = Some(sequence);
                Ok(Some(snapshot))
            }
            Some("heartbeat") => {
                ensure!(
                    self.epoch.as_deref() == Some(string(&frame, "epoch")?)
                        && self.sequence == Some(number(&frame, "sequence")?),
                    "Sync heartbeat baseline changed; reconnecting"
                );
                Ok(None)
            }
            Some("activity") => {
                let scope = string(&frame, "scope")?.to_owned();
                let events = frame.get("events").context("Missing activity events")?;
                let items = indexed(events)?;
                let ordered = ordered(events, frame.get("order"), &items)?;
                let _: Vec<crate::model::ActivityEvent> = serde_json::from_value(ordered.clone())?;
                self.activity.insert(scope, ordered);
                Ok(None)
            }
            Some("activity-delta") => {
                let scope = string(&frame, "scope")?.to_owned();
                let previous = self
                    .activity
                    .get(&scope)
                    .context("Missing activity baseline")?;
                let mut items = indexed(previous)?;
                let delta = frame.get("delta").context("Missing activity delta")?;
                for change in delta
                    .get("changes")
                    .and_then(Value::as_array)
                    .context("Missing activity changes")?
                {
                    let fields = change.get("fields").context("Missing activity fields")?;
                    let id = string(fields, "id")?;
                    let payload = match change.get("payload").context("Missing activity payload")? {
                        Value::String(text) => text.clone(),
                        patch => {
                            let old = string(
                                items.get(id).context("Missing activity baseline")?,
                                "payload",
                            )?;
                            let mut units: Vec<u16> = old.encode_utf16().collect();
                            ensure!(
                                units.len() as u64 == number(patch, "length")?,
                                "Activity baseline mismatch"
                            );
                            let offset = usize::try_from(number(patch, "offset")?)?;
                            let remove = usize::try_from(number(patch, "remove")?)?;
                            let end = offset
                                .checked_add(remove)
                                .context("Activity offset overflow")?;
                            ensure!(end <= units.len(), "Activity patch exceeds baseline");
                            units.splice(offset..end, string(patch, "insert")?.encode_utf16());
                            String::from_utf16(&units)
                                .context("Activity patch splits a Unicode character")?
                        }
                    };
                    let mut event = object(fields)?.clone();
                    event.insert("payload".into(), Value::String(payload));
                    items.insert(id.to_owned(), Value::Object(event));
                }
                let ordered = ordered(previous, delta.get("order"), &items)?;
                let _: Vec<crate::model::ActivityEvent> = serde_json::from_value(ordered.clone())?;
                self.activity.insert(scope, ordered);
                Ok(None)
            }
            Some("error") => anyhow::bail!(
                "{}",
                frame
                    .get("message")
                    .and_then(Value::as_str)
                    .unwrap_or("Runtime synchronization failed")
            ),
            _ => anyhow::bail!("Unknown synchronization frame"),
        }
    }
    pub fn resume(&self) -> Value {
        match (&self.epoch, self.sequence) {
            (Some(epoch), Some(sequence)) => {
                json!({ "type": "resume", "epoch": epoch, "sequence": sequence })
            }
            _ => json!({ "type": "resume" }),
        }
    }
}

fn object(value: &Value) -> Result<&serde_json::Map<String, Value>> {
    value.as_object().context("Expected an object")
}
fn string<'a>(value: &'a Value, key: &str) -> Result<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .with_context(|| format!("Missing {key}"))
}
fn number(value: &Value, key: &str) -> Result<u64> {
    value
        .get(key)
        .and_then(Value::as_u64)
        .with_context(|| format!("Missing {key}"))
}
fn indexed(items: &Value) -> Result<BTreeMap<String, Value>> {
    items
        .as_array()
        .context("Expected an array")?
        .iter()
        .map(|item| Ok((string(item, "id")?.to_owned(), item.clone())))
        .collect()
}
fn ordered(
    previous: &Value,
    order: Option<&Value>,
    items: &BTreeMap<String, Value>,
) -> Result<Value> {
    let ids: Vec<String> = match order {
        Some(order) => order
            .as_array()
            .context("Invalid ordering")?
            .iter()
            .map(|id| id.as_str().map(str::to_owned).context("Invalid ordered ID"))
            .collect::<Result<_>>()?,
        None => previous
            .as_array()
            .context("Missing ordering baseline")?
            .iter()
            .map(|item| Ok(string(item, "id")?.to_owned()))
            .collect::<Result<_>>()?,
    };
    Ok(Value::Array(
        ids.into_iter()
            .map(|id| items.get(&id).cloned().context("Missing ordered entity"))
            .collect::<Result<_>>()?,
    ))
}

pub fn apply_delta(snapshot: &mut Value, delta: &Value) -> Result<()> {
    let original = snapshot.clone();
    let next = snapshot.as_object_mut().context("Invalid snapshot")?;
    if let Some(state) = delta.get("state") {
        let workspace = next
            .get("workspace")
            .cloned()
            .context("Missing workspace")?;
        *next = object(state)?.clone();
        next.insert("workspace".into(), workspace);
    }
    if let Some(revision) = delta.get("revision") {
        next.insert("revision".into(), revision.clone());
    }
    let workspace_delta = delta.get("workspace").context("Missing workspace delta")?;
    let workspace = next
        .get_mut("workspace")
        .and_then(Value::as_object_mut)
        .context("Invalid workspace")?;
    if let Some(metadata) = workspace_delta.get("metadata") {
        let collections: Vec<_> = ["agents", "repositories", "tasks", "automations"]
            .iter()
            .map(|key| {
                Ok((
                    (*key).to_owned(),
                    workspace.get(*key).cloned().context("Missing collection")?,
                ))
            })
            .collect::<Result<_>>()?;
        *workspace = object(metadata)?.clone();
        workspace.extend(collections);
    }
    for key in ["agents", "repositories", "automations"] {
        if let Some(value) = workspace_delta.get(key) {
            workspace.insert(key.into(), value.clone());
        }
    }
    if let Some(delta) = workspace_delta.get("tasks") {
        let before = original
            .pointer("/workspace/tasks")
            .context("Missing tasks")?;
        let mut tasks = indexed(before)?;
        for change in delta
            .get("changes")
            .and_then(Value::as_array)
            .context("Missing task changes")?
        {
            let id = string(change, "id")?;
            let previous = tasks.get(id).cloned();
            let mut task = change
                .get("fields")
                .cloned()
                .or_else(|| previous.clone())
                .context("Missing task baseline")?;
            ensure!(string(&task, "id")? == id, "Task ID mismatch");
            if let Some(fields) = change.get("fieldDelta") {
                ensure!(
                    previous.is_some() && change.get("fields").is_none(),
                    "Ambiguous task baseline"
                );
                let task_fields = task.as_object_mut().context("Invalid task")?;
                task_fields
                    .extend(object(fields.get("values").context("Missing field values")?)?.clone());
                for key in fields
                    .get("removed")
                    .and_then(Value::as_array)
                    .context("Missing removed fields")?
                {
                    task_fields.remove(key.as_str().context("Invalid removed field")?);
                }
            }
            let empty = json!([]);
            let messages_before = previous
                .as_ref()
                .and_then(|task| task.get("messages"))
                .unwrap_or(&empty);
            let mut messages = indexed(messages_before)?;
            if let Some(changes) = change.get("messages") {
                for update in changes
                    .get("changes")
                    .and_then(Value::as_array)
                    .context("Missing message changes")?
                {
                    let fields = update.get("fields").context("Missing message fields")?;
                    let message_id = string(fields, "id")?;
                    let text = match update.get("text").context("Missing message text")? {
                        Value::String(text) => text.clone(),
                        patch => {
                            let old = messages
                                .get(message_id)
                                .context("Missing message baseline")?;
                            let old_text = string(old, "text")?;
                            ensure!(
                                old_text.encode_utf16().count() as u64 == number(patch, "length")?,
                                "Text baseline mismatch"
                            );
                            format!("{old_text}{}", string(patch, "append")?)
                        }
                    };
                    let mut message = object(fields)?.clone();
                    message.insert("text".into(), Value::String(text));
                    messages.insert(message_id.to_owned(), Value::Object(message));
                }
            }
            let message_order = change.get("messages").and_then(|value| value.get("order"));
            task["messages"] = ordered(messages_before, message_order, &messages)?;
            if let Some(updated) = change.get("updatedAt") {
                if updated.is_null() {
                    task.as_object_mut()
                        .context("Invalid task")?
                        .remove("updatedAt");
                } else {
                    task["updatedAt"] = updated.clone();
                }
            }
            tasks.insert(id.to_owned(), task);
        }
        workspace.insert("tasks".into(), ordered(before, delta.get("order"), &tasks)?);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn streaming_offsets_use_utf16_and_preserve_unrelated_data() {
        let mut snapshot = json!({"revision": 1, "workspace": {"version":1,"unknown":"keep","tasks":[{"id":"t","title":"Task","messages":[{"id":"m","role":"assistant","text":"Hi 🦀"}]}]}});
        let delta = json!({"revision":2,"workspace":{"tasks":{"changes":[{"id":"t","fieldDelta":{"values":{"title":"Updated"},"removed":[]},"messages":{"changes":[{"fields":{"id":"m","role":"assistant"},"text":{"length":5,"append":"!"}}]}}]}}});
        apply_delta(&mut snapshot, &delta).unwrap();
        assert_eq!(
            snapshot
                .pointer("/workspace/tasks/0/messages/0/text")
                .unwrap(),
            "Hi 🦀!"
        );
        assert_eq!(snapshot.pointer("/workspace/unknown").unwrap(), "keep");
        assert_eq!(
            snapshot.pointer("/workspace/tasks/0/title").unwrap(),
            "Updated"
        );
    }
    #[test]
    fn rejects_missing_text_baseline() {
        let mut snapshot =
            json!({"workspace":{"tasks":[{"id":"t","messages":[{"id":"m","text":"🦀"}]}]}});
        let delta = json!({"workspace":{"tasks":{"changes":[{"id":"t","messages":{"changes":[{"fields":{"id":"m"},"text":{"length":1,"append":"!"}}]}}]}}});
        assert!(apply_delta(&mut snapshot, &delta).is_err());
    }
    #[test]
    fn ordering_handles_additions_and_removals() {
        let mut snapshot = json!({"workspace":{"tasks":[{"id":"old","messages":[]}]}});
        let delta = json!({"workspace":{"tasks":{"order":["new"],"changes":[{"id":"new","fields":{"id":"new","title":"New"},"messages":{"order":["m"],"changes":[{"fields":{"id":"m","role":"user"},"text":"Hello"}]}}]}}});
        apply_delta(&mut snapshot, &delta).unwrap();
        assert_eq!(snapshot.pointer("/workspace/tasks/0/id").unwrap(), "new");
        assert_eq!(
            snapshot
                .pointer("/workspace/tasks/0/messages/0/text")
                .unwrap(),
            "Hello"
        );
        assert_eq!(
            snapshot
                .pointer("/workspace/tasks")
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            1
        );
    }
}
