use crate::connection::{Connection, RuntimeClient};
use anyhow::{Context, Result, ensure};
use std::path::{Path, PathBuf};

fn candidates() -> Result<Vec<PathBuf>> {
    if let Some(path) = std::env::var_os("DOVO_DATABASE_PATH") {
        return Ok(vec![
            PathBuf::from(path)
                .parent()
                .context("Invalid database path")?
                .to_owned(),
        ]);
    }
    if let Some(path) = std::env::var_os("DOVO_DATA_ROOT") {
        let path = PathBuf::from(path);
        return Ok(vec![path.clone(), path.join("desktop")]);
    }
    let base = directories::BaseDirs::new().context("Cannot find the home directory")?;
    Ok(vec![
        base.home_dir().join(".dovo/desktop"),
        base.home_dir().join(".dovo"),
        base.home_dir().join(".dovo-dev/desktop"),
        base.config_dir().join("@dovo/desktop"),
        base.config_dir().join("Dovo Studio"),
    ])
}
fn validate_database(directory: &Path, database: Option<&Path>) -> Result<()> {
    let Some(database) = database else {
        return Ok(());
    };
    let config = directory.join("server.json");
    if !config.is_file() {
        return Ok(());
    }
    let value: serde_json::Value = serde_json::from_slice(&std::fs::read(config)?)
        .context("Invalid local server configuration; the file has been preserved")?;
    let saved = value
        .get("databasePath")
        .and_then(serde_json::Value::as_str)
        .context("The local server configuration has no database path")?;
    fn resolve(path: &Path) -> Result<PathBuf> {
        let path = std::path::absolute(path)?;
        if path.exists() {
            return Ok(path.canonicalize()?);
        }
        let parent = path
            .parent()
            .context("Invalid database path")?
            .canonicalize()?;
        Ok(parent.join(path.file_name().context("Invalid database filename")?))
    }
    ensure!(
        resolve(Path::new(saved))? == resolve(database)?,
        "The existing runtime uses a different database. Choose its database path or a separate data directory; no configuration was changed."
    );
    Ok(())
}

fn runtime_executables() -> Result<(PathBuf, PathBuf)> {
    let executable = std::env::current_exe()?;
    let directory = executable
        .parent()
        .context("Cannot find the GPUI application directory")?;
    let node_name = if cfg!(windows) { "node.exe" } else { "node" };
    // Archives place the native binary alongside libexec; macOS app bundles use Resources.
    for base in [directory.to_owned(), directory.join("../Resources")] {
        let cli = base.join("libexec/server/dist/server-cli.js");
        if cli.is_file() {
            let node = base.join("libexec").join(node_name);
            ensure!(
                node.is_file(),
                "The bundled runtime is missing its Node executable"
            );
            return Ok((node, cli));
        }
    }
    let cli = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../api/dist/server-cli.js");
    ensure!(
        cli.is_file(),
        "Build the runtime first with pnpm --filter @dovo/api... -r build"
    );
    Ok((PathBuf::from(node_name), cli))
}

async fn read_live(directory: &Path) -> Result<Connection> {
    let bytes = std::fs::read(directory.join("runtime-connection.json"))?;
    let connection: Connection = serde_json::from_slice(&bytes)
        .context("Invalid local runtime connection; the file has been preserved")?;
    let client = RuntimeClient::new(connection)?;
    let _: serde_json::Value = client.snapshot(None).await?;
    Ok(client.connection)
}
pub async fn attach_or_start() -> Result<Connection> {
    let candidates = candidates()?;
    let database = std::env::var_os("DOVO_DATABASE_PATH").map(PathBuf::from);
    // Authenticate discovery; a path alone is not evidence that a runtime is reachable.
    for directory in &candidates {
        validate_database(directory, database.as_deref())?;
        if directory.join("runtime-connection.json").is_file() {
            let bytes = std::fs::read(directory.join("runtime-connection.json"))?;
            let _: Connection = serde_json::from_slice(&bytes).with_context(|| {
                format!(
                    "Invalid runtime connection in {}; the file has been preserved",
                    directory.display()
                )
            })?;
            if let Ok(connection) = read_live(directory).await {
                return Ok(connection);
            }
        }
    }
    let explicit = std::env::var_os("DOVO_DATABASE_PATH").is_some()
        || std::env::var_os("DOVO_DATA_ROOT").is_some();
    let directory = candidates
        .iter()
        .find(|directory| {
            [
                "server.json",
                "runtime-connection.json",
                "runtime.sqlite",
                "runtime-listen.json",
            ]
            .iter()
            .any(|name| directory.join(name).exists())
        })
        .cloned()
        .or_else(|| {
            if explicit {
                candidates.first().cloned()
            } else {
                candidates.get(2).cloned()
            }
        })
        .context("Cannot select the local runtime directory")?;
    attach_or_start_in(directory, database).await
}
pub async fn attach_or_start_in(
    directory: PathBuf,
    database: Option<PathBuf>,
) -> Result<Connection> {
    validate_database(&directory, database.as_deref())?;
    let (node, cli) = runtime_executables()?;
    let target = directory.clone();
    tokio::task::spawn_blocking(move || -> Result<()> {
        if !target.join("server.json").is_file() {
            let mut command = std::process::Command::new(&node);
            command
                .arg(&cli)
                .args(["setup", "--data-dir"])
                .arg(&target)
                .arg("--json");
            if let Some(path) = database {
                command.arg("--database").arg(path);
            }
            let output = command
                .output()
                .context("Could not configure the local runtime")?;
            ensure!(
                output.status.success(),
                "Local runtime setup failed: {}",
                String::from_utf8_lossy(&output.stderr)
            );
        }
        // The runtime manager owns process locks and refuses to duplicate a live,
        // unreachable process over the same database. Existing listen settings survive setup.
        let output = std::process::Command::new(&node)
            .arg(cli)
            .args(["start", "--data-dir"])
            .arg(target)
            .arg("--json")
            .output()
            .context("Could not launch the local runtime manager")?;
        ensure!(
            output.status.success(),
            "Local runtime did not start: {}",
            String::from_utf8_lossy(&output.stderr)
        );
        Ok(())
    })
    .await??;
    read_live(&directory).await
}
