use crate::connection::Connection;
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{fs, io::Write, path::PathBuf};

#[derive(Clone, Serialize, Deserialize)]
pub struct SavedMessage {
    pub key: String,
    pub path: String,
    pub input: Value,
}

pub struct Outbox {
    path: PathBuf,
    pub messages: Vec<SavedMessage>,
}
impl Outbox {
    pub fn open(directory: &std::path::Path, connection: &Connection) -> Result<Self> {
        let digest =
            Sha256::digest(format!("{}\0{}", connection.address, connection.token).as_bytes());
        let fingerprint: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
        let path = directory.join(format!("outbox-{fingerprint}.json"));
        let messages = match fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .context("Saved outgoing messages are invalid. The file has been preserved.")?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
            Err(error) => return Err(error.into()),
        };
        Ok(Self { path, messages })
    }
    pub fn save(&mut self, message: SavedMessage) -> Result<()> {
        let id_field = match message.path.as_str() {
            "/api/tasks/message" | "/api/tasks/steer" => "messageId",
            "/api/jobs/run" | "/api/review/task/start" => "requestId",
            "/api/review/task/fix" => "messageId",
            _ => anyhow::bail!("Only ID-deduplicated requests can be saved for retry"),
        };
        ensure!(
            message
                .input
                .get(id_field)
                .and_then(Value::as_str)
                .is_some_and(|id| !id.is_empty()),
            "A stable delivery ID is required"
        );
        if let Some(previous) = self.messages.iter().find(|item| item.key == message.key) {
            ensure!(
                previous.input == message.input && previous.path == message.path,
                "The saved message must keep its original delivery ID and input"
            );
            return Ok(());
        }
        let mut next = self.messages.clone();
        next.push(message);
        self.write(&next)?;
        self.messages = next;
        Ok(())
    }
    pub fn remove(&mut self, key: &str) -> Result<()> {
        let next: Vec<_> = self
            .messages
            .iter()
            .filter(|message| message.key != key)
            .cloned()
            .collect();
        self.write(&next)?;
        self.messages = next;
        Ok(())
    }
    fn write(&self, messages: &[SavedMessage]) -> Result<()> {
        let parent = self.path.parent().context("Missing app data directory")?;
        fs::create_dir_all(parent)?;
        let temporary = self.path.with_extension("json.tmp");
        let mut options = fs::OpenOptions::new();
        options.create(true).truncate(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary)?;
        file.write_all(&serde_json::to_vec(messages)?)?;
        file.sync_all()?;
        drop(file);
        fs::rename(temporary, &self.path).context("Could not durably save outgoing messages")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn automation_starts_keep_the_same_request_after_restart() {
        let directory = tempfile::tempdir().unwrap();
        let connection = Connection {
            address: "http://host".into(),
            token: "private".into(),
        };
        let mut journal = Outbox::open(directory.path(), &connection).unwrap();
        journal
            .save(SavedMessage {
                key: "job-run:flow".into(),
                path: "/api/jobs/run".into(),
                input: json!({"id":"flow","requestId":"original-request"}),
            })
            .unwrap();
        let mut restored = Outbox::open(directory.path(), &connection).unwrap();
        assert_eq!(restored.messages[0].input["requestId"], "original-request");
        assert!(
            restored
                .save(SavedMessage {
                    key: "job-run:flow".into(),
                    path: "/api/jobs/run".into(),
                    input: json!({"id":"flow","requestId":"new-request"})
                })
                .is_err()
        );
        assert!(
            restored
                .save(SavedMessage {
                    key: "job-run:other".into(),
                    path: "/api/jobs/run".into(),
                    input: json!({"id":"other"})
                })
                .is_err()
        );
    }
    #[test]
    fn uncertain_messages_keep_their_delivery_ids_across_restarts() {
        let directory = tempfile::tempdir().unwrap();
        let connection = Connection {
            address: "http://host:8787".into(),
            token: "credential".into(),
        };
        let message = SavedMessage {
            key: "send:t:m".into(),
            path: "/api/tasks/message".into(),
            input: json!({"id":"t","messageId":"m","text":"Hello"}),
        };
        let mut journal = Outbox::open(directory.path(), &connection).unwrap();
        journal.save(message.clone()).unwrap();
        journal.save(message.clone()).unwrap();
        let mut restored = Outbox::open(directory.path(), &connection).unwrap();
        assert_eq!(restored.messages.len(), 1);
        assert_eq!(restored.messages[0].input["messageId"], "m");
        assert!(
            Outbox::open(
                directory.path(),
                &Connection {
                    token: "other-device".into(),
                    ..connection
                }
            )
            .unwrap()
            .messages
            .is_empty()
        );
        restored.remove(&message.key).unwrap();
        assert!(restored.messages.is_empty());
    }
    #[test]
    fn saved_messages_cannot_change_under_an_existing_receipt_id() {
        let directory = tempfile::tempdir().unwrap();
        let connection = Connection {
            address: "http://host".into(),
            token: "credential".into(),
        };
        let mut journal = Outbox::open(directory.path(), &connection).unwrap();
        journal
            .save(SavedMessage {
                key: "m".into(),
                path: "/api/tasks/steer".into(),
                input: json!({"messageId":"m","text":"Hello","runId":"original-run"}),
            })
            .unwrap();
        assert!(
            journal
                .save(SavedMessage {
                    key: "m".into(),
                    path: "/api/tasks/steer".into(),
                    input: json!({"messageId":"m","text":"Hello","runId":"new-run"})
                })
                .is_err()
        );
    }
}

#[cfg(test)]
mod review_tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn review_retries_preserve_the_reviewer_scope_and_fix_message() {
        let directory = tempfile::tempdir().unwrap();
        let connection = Connection {
            address: "http://private".into(),
            token: "private-token".into(),
        };
        let mut outbox = Outbox::open(directory.path(), &connection).unwrap();
        for (path, input) in [
            (
                "/api/review/task/start",
                json!({"taskId":"task","requestId":"start-id","agentId":"reviewer","scope":"branch"}),
            ),
            (
                "/api/review/task/fix",
                json!({"taskId":"task","messageId":"fix-id","reviewId":"review","findingIds":["finding"]}),
            ),
        ] {
            outbox
                .save(SavedMessage {
                    key: path.into(),
                    path: path.into(),
                    input,
                })
                .unwrap();
        }
        let mut restored = Outbox::open(directory.path(), &connection).unwrap();
        assert_eq!(restored.messages[0].input["scope"], "branch");
        assert_eq!(restored.messages[1].input["messageId"], "fix-id");
        assert!(
            restored
                .save(SavedMessage {
                    key: "/api/review/task/start".into(),
                    path: "/api/review/task/start".into(),
                    input: json!({"taskId":"task","requestId":"start-id","scope":"working"})
                })
                .is_err()
        );
    }
}
