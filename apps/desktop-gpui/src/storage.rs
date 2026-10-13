use crate::connection::Connection;
use anyhow::{Context, Result};
use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};

#[derive(Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Appearance {
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub address: String,
}
#[derive(Clone, Serialize, Deserialize, Default)]
pub struct Registry {
    pub active_id: Option<String>,
    pub profiles: Vec<Profile>,
}

#[derive(Clone)]
pub struct Storage {
    pub directory: PathBuf,
}
impl Storage {
    pub fn appearance(&self) -> Result<Appearance> {
        match fs::read(self.directory.join("appearance.json")) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .context("Saved appearance is invalid; the original file has been preserved"),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Appearance::default()),
            Err(error) => Err(error.into()),
        }
    }
    pub fn save_appearance(&self, appearance: Appearance) -> Result<()> {
        fs::create_dir_all(&self.directory)?;
        let temporary = self.directory.join("appearance.json.tmp");
        fs::write(&temporary, serde_json::to_vec(&appearance)?)?;
        fs::rename(temporary, self.directory.join("appearance.json"))
            .context("Could not save appearance")
    }
    pub fn new() -> Result<Self> {
        let dirs = ProjectDirs::from("dev", "dovo", "Dovo Studio GPUI")
            .context("Cannot locate the app data directory")?;
        Ok(Self {
            directory: dirs.data_local_dir().to_owned(),
        })
    }
    pub fn read(&self) -> Result<Registry> {
        match fs::read(self.directory.join("connections.json")) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .context("Saved connections are invalid; the original file has been preserved"),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Registry::default()),
            Err(error) => Err(error.into()),
        }
    }
    pub fn write(&self, registry: &Registry) -> Result<()> {
        fs::create_dir_all(&self.directory)?;
        let path = self.directory.join("connections.json");
        let temporary = self.directory.join("connections.json.tmp");
        fs::write(&temporary, serde_json::to_vec_pretty(registry)?)?;
        fs::rename(temporary, path).context("Could not save connections")
    }
    fn credential(&self, profile: &Profile) -> Result<keyring::Entry> {
        // Use an independent service identity; never overwrite Electron credentials.
        keyring::Entry::new("dev.dovo.studio.gpui", &profile.id)
            .context("Cannot access system credential storage")
    }
    pub fn connection(&self, profile: &Profile) -> Result<Connection> {
        Ok(Connection {
            address: profile.address.clone(),
            token: self
                .credential(profile)?
                .get_password()
                .context("Could not unlock this computer's device token")?,
        })
    }
    pub fn save_token(&self, profile: &Profile, token: &str) -> Result<()> {
        self.credential(profile)?.set_password(token).context(
            "Could not securely save the device token. Unlock the system keychain and retry.",
        )
    }
    pub fn forget(&self, profile: &Profile) -> Result<()> {
        match self.credential(profile)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(error.into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn metadata_never_contains_device_tokens() {
        let directory = tempfile::tempdir().unwrap();
        let storage = Storage {
            directory: directory.path().into(),
        };
        let registry = Registry {
            active_id: Some("host".into()),
            profiles: vec![Profile {
                id: "host".into(),
                name: "Computer".into(),
                address: "http://host:8787".into(),
            }],
        };
        storage.write(&registry).unwrap();
        assert_eq!(
            storage.read().unwrap().profiles[0].address,
            "http://host:8787"
        );
        let json = fs::read_to_string(directory.path().join("connections.json")).unwrap();
        assert!(!json.contains("token"));
    }
    #[test]
    fn invalid_saved_data_is_preserved() {
        let directory = tempfile::tempdir().unwrap();
        fs::write(directory.path().join("connections.json"), b"bad data").unwrap();
        let storage = Storage {
            directory: directory.path().into(),
        };
        assert!(storage.read().is_err());
        assert_eq!(
            fs::read(directory.path().join("connections.json")).unwrap(),
            b"bad data"
        );
    }
}
