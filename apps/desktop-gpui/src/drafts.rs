use crate::connection::Connection;
use anyhow::{Context, Result};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
};

pub struct Drafts {
    path: PathBuf,
    pub values: BTreeMap<String, String>,
}
impl Drafts {
    pub fn open(directory: &Path, connection: &Connection) -> Result<Self> {
        let digest =
            Sha256::digest(format!("{}\0{}", connection.address, connection.token).as_bytes());
        let fingerprint: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
        let path = directory.join(format!("drafts-{fingerprint}.json"));
        let values = match fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .context("Saved drafts are invalid; the original file has been preserved")?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => BTreeMap::new(),
            Err(error) => return Err(error.into()),
        };
        Ok(Self { path, values })
    }
    pub fn save(&mut self, id: String, text: String) -> Result<()> {
        let mut next = self.values.clone();
        // Retain an empty draft to distinguish deliberate clearing from runtime defaults.
        next.insert(id, text);
        fs::create_dir_all(self.path.parent().context("Missing draft directory")?)?;
        let temporary = self.path.with_extension("json.tmp");
        let mut options = fs::OpenOptions::new();
        options.create(true).truncate(true).write(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temporary)?;
        file.write_all(&serde_json::to_vec(&next)?)?;
        file.sync_all()?;
        drop(file);
        fs::rename(temporary, &self.path)?;
        self.values = next;
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn restores_unsent_text_without_crossing_credentials() {
        let dir = tempfile::tempdir().unwrap();
        let first = Connection {
            address: "http://computer:1234".into(),
            token: "first-secret".into(),
        };
        Drafts::open(dir.path(), &first)
            .unwrap()
            .save("task".into(), "unsent".into())
            .unwrap();
        assert_eq!(
            Drafts::open(dir.path(), &first).unwrap().values["task"],
            "unsent"
        );
        let second = Connection {
            token: "second-secret".into(),
            ..first
        };
        assert!(Drafts::open(dir.path(), &second).unwrap().values.is_empty());
    }
}
