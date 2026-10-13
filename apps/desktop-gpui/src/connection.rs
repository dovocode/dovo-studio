use anyhow::{Context, Result, bail, ensure};
use reqwest::{Client, Method};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::Value;
use std::time::Duration;
use url::Url;

#[derive(Clone, Serialize, Deserialize)]
pub struct Connection {
    pub address: String,
    pub token: String,
}

pub fn normalize_address(input: &str) -> Result<String> {
    let input = input.trim().trim_end_matches('/');
    ensure!(!input.is_empty(), "Enter the runtime address");
    let text = if input.contains("://") {
        input.to_owned()
    } else {
        format!("http://{input}")
    };
    let url = Url::parse(&text).context("Invalid runtime address")?;
    ensure!(
        matches!(url.scheme(), "http" | "https"),
        "Use an HTTP or HTTPS runtime address"
    );
    ensure!(
        url.username().is_empty() && url.password().is_none(),
        "Runtime addresses cannot contain credentials"
    );
    ensure!(
        !matches!(
            url.host_str(),
            None | Some("0.0.0.0") | Some("[::]") | Some("::")
        ),
        "Use the computer's LAN or VPN address, not its listen address"
    );
    ensure!(
        matches!(url.path(), "" | "/") && url.query().is_none() && url.fragment().is_none(),
        "Enter the runtime origin without a path or query"
    );
    Ok(url.origin().ascii_serialization())
}

#[derive(Clone)]
pub struct RuntimeClient {
    pub connection: Connection,
    client: Client,
}

impl RuntimeClient {
    pub fn new(connection: Connection) -> Result<Self> {
        ensure!(
            !connection.token.is_empty(),
            "A paired device token is required"
        );
        let address = normalize_address(&connection.address)?;
        Ok(Self {
            connection: Connection {
                address,
                ..connection
            },
            client: Client::builder()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(30))
                .build()?,
        })
    }

    pub async fn request<T: DeserializeOwned>(
        &self,
        method: Method,
        path: &str,
        input: Option<&Value>,
    ) -> Result<T> {
        request(
            &self.client,
            &self.connection.address,
            Some(&self.connection.token),
            method,
            path,
            input,
        )
        .await
    }
    pub async fn post<T: DeserializeOwned>(&self, path: &str, input: &Value) -> Result<T> {
        self.request(Method::POST, path, Some(input)).await
    }
    pub async fn snapshot(&self, task: Option<&str>) -> Result<Value> {
        let mut path = Url::parse(&self.connection.address)?.join("/api/snapshot")?;
        path.query_pairs_mut().append_pair("history", "paged");
        if let Some(task) = task {
            path.query_pairs_mut()
                .append_pair("scope", "threads")
                .append_pair("task", task);
        }
        self.request(
            Method::GET,
            &format!("{}?{}", path.path(), path.query().unwrap_or_default()),
            None,
        )
        .await
    }
    pub fn websocket_url(&self, path: &str, ticket: &str) -> Result<Url> {
        let mut url = Url::parse(&self.connection.address)?.join(path)?;
        let scheme = if url.scheme() == "https" { "wss" } else { "ws" };
        url.set_scheme(scheme)
            .map_err(|_| anyhow::anyhow!("Invalid socket address"))?;
        url.query_pairs_mut().append_pair("ticket", ticket);
        Ok(url)
    }
}

pub async fn public_post<T: DeserializeOwned>(
    address: &str,
    path: &str,
    input: &Value,
) -> Result<T> {
    let client = Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(Duration::from_secs(10))
        .build()?;
    request(
        &client,
        &normalize_address(address)?,
        None,
        Method::POST,
        path,
        Some(input),
    )
    .await
}

async fn request<T: DeserializeOwned>(
    client: &Client,
    address: &str,
    token: Option<&str>,
    method: Method,
    path: &str,
    input: Option<&Value>,
) -> Result<T> {
    ensure!(
        path.starts_with('/') && !path.starts_with("//"),
        "Requests must stay on the configured runtime"
    );
    let origin = Url::parse(address)?;
    let url = origin.join(path)?;
    ensure!(
        url.origin() == origin.origin(),
        "Requests must stay on the configured runtime"
    );
    let mut builder = client.request(method, url);
    let timeout = match path {
        "/api/mcp-apps/rpc" => match input
            .and_then(|value| value.get("method"))
            .and_then(Value::as_str)
        {
            Some("tools/call") => 750,
            Some("ui/cancel") => 30,
            _ => 150,
        },
        "/api/agents/models"
        | "/api/agents/availability"
        | "/api/usage/history/read"
        | "/api/usage/limits/read" => 120,
        "/api/tasks/commit-message" | "/api/tasks/side-chat/ask" | "/api/tasks/aside" => 120,
        "/api/tasks/commit" => 180,
        "/api/scm/repositories/add" => 330,
        path if path.starts_with("/api/scm/pulls/") || path.starts_with("/api/scm/work/") => 180,
        path if path.starts_with("/api/previews/") => 120,
        _ => 30,
    };
    builder = builder.timeout(Duration::from_secs(timeout));
    if let Some(token) = token {
        builder = builder.bearer_auth(token);
    }
    if let Some(input) = input {
        builder = builder.json(input);
    }
    let response = builder.send().await.map_err(|error| {
        if error.is_timeout() { anyhow::anyhow!("The runtime did not respond in time. Check the connection before retrying.") }
        else { anyhow::anyhow!("Cannot reach the runtime. Check that it is running and both devices are on the same LAN or VPN.") }
    })?;
    let status = response.status();
    let bytes = response
        .bytes()
        .await
        .context("Connection lost while reading the response")?;
    if !status.is_success() {
        let message = serde_json::from_slice::<Value>(&bytes)
            .ok()
            .and_then(|value| {
                value
                    .get("error")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            });
        bail!(
            "{}",
            message.unwrap_or_else(|| format!("Runtime returned HTTP {status}"))
        );
    }
    serde_json::from_slice(&bytes).context("Runtime returned an invalid response")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn lan_addresses_remain_http() {
        assert_eq!(
            normalize_address(" 100.64.0.4:8787/ ").unwrap(),
            "http://100.64.0.4:8787"
        );
        assert_eq!(
            normalize_address("http://host.local:8787").unwrap(),
            "http://host.local:8787"
        );
        assert_eq!(
            normalize_address("https://example.com").unwrap(),
            "https://example.com"
        );
        assert_eq!(
            normalize_address("[fd00::1]:8787").unwrap(),
            "http://[fd00::1]:8787"
        );
    }
    #[test]
    fn rejects_credentials_and_non_origins() {
        for value in [
            "",
            "ftp://host",
            "http://user:secret@host",
            "http://0.0.0.0:8787",
            "http://[::]:8787",
            "http://host/api",
            "http://host?token=x",
        ] {
            assert!(normalize_address(value).is_err(), "{value}");
        }
    }
    #[test]
    fn sockets_use_short_lived_tickets() {
        let client = RuntimeClient::new(Connection {
            address: "http://host:8787".into(),
            token: "permanent-secret".into(),
        })
        .unwrap();
        assert_eq!(
            client
                .websocket_url("/ws/sync", "temporary")
                .unwrap()
                .as_str(),
            "ws://host:8787/ws/sync?ticket=temporary"
        );
    }
}
