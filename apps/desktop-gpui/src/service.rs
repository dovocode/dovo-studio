use crate::outbox::{Outbox, SavedMessage};
use crate::{
    connection::{Connection, RuntimeClient, normalize_address, public_post},
    model::Snapshot,
    storage::{Profile, Registry, Storage},
    sync::Replica,
};
use anyhow::{Context, Result, ensure};
use base64::{Engine, engine::general_purpose::STANDARD};
use futures_util::{SinkExt, StreamExt};
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::time::Duration;
use tokio::sync::{mpsc, watch};
use tokio_tungstenite::{connect_async, tungstenite::Message};

pub enum Command {
    BrowserAction {
        generation: u64,
        id: String,
        action: String,
    },
    ReadFleet {
        generation: u64,
        request: u64,
        profiles: Vec<Profile>,
        sessions: Vec<Connection>,
    },
    McpTools {
        generation: u64,
        task: String,
        id: String,
        nonce: String,
        tools: Value,
    },
    McpToolResult {
        generation: u64,
        nonce: String,
        payload: Value,
    },
    McpClose {
        generation: u64,
        nonce: String,
    },
    McpExport {
        generation: u64,
        task: String,
        id: String,
        nonce: String,
        request: String,
        params: Value,
    },
    Connect {
        connection: Connection,
        open_task: Option<String>,
    },
    SaveDraft {
        generation: u64,
        id: String,
        text: String,
    },
    ChainTask {
        generation: u64,
        id: String,
        source: String,
        before: String,
        draft: String,
    },
    Disconnect,
    LocalRuntime,
    McpIpc {
        generation: u64,
        nonce: String,
        payload: Value,
    },
    Select(Option<String>),
    Request {
        generation: u64,
        key: String,
        method: Method,
        path: String,
        input: Value,
    },
    Pair {
        address: String,
        code: String,
        name: String,
    },
    Claim,
    CancelPairing,
    OpenTerminal(String),
    DeviceOpen {
        generation: u64,
        id: String,
        ticket: String,
    },
    DeviceInput {
        generation: u64,
        input: Value,
    },
    DeviceClose,
    DetachTerminals,
    TerminalInput {
        id: String,
        data: String,
    },
    TerminalBytesInput {
        id: String,
        data: Vec<u8>,
    },
    TerminalResize {
        id: String,
        rows: u16,
        cols: u16,
    },
    RetryMessage(String),
    DiscardMessage(String),
}
pub enum Event {
    BrowserAction {
        generation: u64,
        id: String,
        action: String,
    },
    Fleet {
        generation: u64,
        request: u64,
        result: Result<Vec<crate::fleet::Entry>, String>,
    },
    McpToolMessage {
        generation: u64,
        nonce: String,
        payload: Value,
    },
    McpClosed {
        generation: u64,
        nonce: String,
    },
    McpExport {
        generation: u64,
        nonce: String,
        request: String,
        result: std::result::Result<Vec<crate::mcp_downloads::Export>, String>,
    },
    Activity {
        generation: u64,
        task: String,
        events: Vec<crate::model::ActivityEvent>,
    },
    Drafts {
        generation: u64,
        values: std::collections::BTreeMap<String, String>,
    },
    McpIpc {
        generation: u64,
        nonce: String,
        payload: Value,
    },
    LocalRuntime(std::result::Result<Connection, String>),
    Connected {
        generation: u64,
        address: String,
        open_task: Option<String>,
    },
    Status {
        generation: u64,
        online: bool,
        detail: String,
    },
    Snapshot {
        generation: u64,
        task: Option<String>,
        snapshot: Box<Snapshot>,
    },
    Response {
        generation: u64,
        key: String,
        result: std::result::Result<Value, String>,
    },
    Pairing {
        pending: bool,
        message: String,
    },
    Registry(Registry),
    Paired {
        registry: Registry,
        connection: Connection,
    },
    DeviceClosed {
        generation: u64,
        id: String,
    },
    DeviceFrame {
        generation: u64,
        id: String,
        frame: crate::device_preview::Frame,
    },
    TerminalStarted {
        generation: u64,
        id: String,
    },
    TerminalData {
        generation: u64,
        id: String,
        data: Vec<u8>,
    },
    Outbox {
        generation: u64,
        messages: Vec<SavedMessage>,
    },
}

#[derive(Clone)]
pub struct Service {
    commands: mpsc::Sender<Command>,
}

#[derive(Clone)]
struct SyncTarget {
    generation: u64,
    client: RuntimeClient,
    task: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PairingProof {
    id: String,
    secret: String,
    expires_at: String,
}
#[derive(Deserialize, Serialize)]
struct PendingPairing {
    profile: Profile,
    proof: PairingProof,
    token: Option<String>,
    #[serde(default)]
    confirmed: bool,
}

impl Service {
    pub fn new(storage: Storage) -> Result<(Self, async_channel::Receiver<Event>)> {
        let (sender, receiver) = mpsc::channel(256);
        let (events, output) = async_channel::bounded(128);
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()?;
        std::thread::Builder::new()
            .name("dovo-runtime-client".into())
            .spawn(move || runtime.block_on(run(receiver, events, storage)))?;
        Ok((Self { commands: sender }, output))
    }
    pub fn send(&self, command: Command) -> Result<()> {
        self.commands
            .try_send(command)
            .context("The runtime worker queue is unavailable; try the action again")
    }
}

async fn run(
    mut commands: mpsc::Receiver<Command>,
    events: async_channel::Sender<Event>,
    storage: Storage,
) {
    let (target_tx, target_rx) = watch::channel(None);
    let sync_events = events.clone();
    let sync = tokio::spawn(synchronize(target_rx, sync_events));
    let mut generation = 0;
    let mut client: Option<RuntimeClient> = None;
    let mut outbox: Option<Outbox> = None;
    let mut drafts: Option<crate::drafts::Drafts> = None;
    let mut pending: Option<PendingPairing> = None;
    let mut fleet_worker: Option<tokio::task::JoinHandle<()>> = None;
    let mut device: Option<(mpsc::Sender<Value>, tokio::task::JoinHandle<()>)> = None;
    let mut terminals: std::collections::HashMap<
        String,
        (mpsc::Sender<Value>, tokio::task::JoinHandle<()>),
    > = Default::default();
    let mut mcp_sockets: std::collections::HashMap<
        String,
        (mpsc::UnboundedSender<Value>, tokio::task::JoinHandle<()>),
    > = Default::default();
    while let Some(command) = commands.recv().await {
        match command {
            Command::ReadFleet {
                generation: expected,
                request,
                profiles,
                sessions,
            } if expected == generation => {
                if let Some(worker) = fleet_worker.take() {
                    worker.abort();
                }
                let storage = storage.clone();
                let active = client.clone();
                let events = events.clone();
                fleet_worker = Some(tokio::spawn(async move {
                    let sources = tokio::task::spawn_blocking(move || {
                        let mut sources = Vec::new();
                        if let Some(client) = active {
                            sources.push((
                                "current".into(),
                                "Current connection".into(),
                                client.connection.address.clone(),
                                Ok(client),
                            ));
                        }
                        for profile in profiles.into_iter().rev() {
                            if sources
                                .iter()
                                .any(|(_, _, address, _)| address == &profile.address)
                            {
                                continue;
                            }
                            let connection =
                                storage.connection(&profile).and_then(RuntimeClient::new);
                            sources.push((profile.id, profile.name, profile.address, connection));
                        }
                        for connection in sessions {
                            if sources
                                .iter()
                                .any(|(_, _, address, _)| address == &connection.address)
                            {
                                continue;
                            }
                            let address = connection.address.clone();
                            sources.push((
                                format!("session:{address}"),
                                address.clone(),
                                address,
                                RuntimeClient::new(connection),
                            ));
                        }
                        sources
                    })
                    .await;
                    let result = match sources {
                        Ok(sources) => Ok(crate::fleet::read(sources).await),
                        Err(error) => Err(format!("Could not read computer credentials: {error}")),
                    };
                    let _ = events
                        .send(Event::Fleet {
                            generation: expected,
                            request,
                            result,
                        })
                        .await;
                }));
            }
            Command::ReadFleet { .. } => {}
            Command::McpTools {
                generation: expected,
                task,
                id,
                nonce,
                tools,
            } => {
                if expected == generation
                    && let Some(client) = client.clone()
                {
                    let value = json!({"type":"tools","tools":tools});
                    if let Some((input, _)) = mcp_sockets.get(&nonce) {
                        if input.send(value).is_err() {
                            let _=events.send(Event::McpIpc{generation,nonce,payload:json!({"type":"error","message":"The app tool worker stopped"})}).await;
                        }
                    } else {
                        let (sender, input) = mpsc::unbounded_channel();
                        let session = crate::mcp_tools::Session {
                            client,
                            generation,
                            task,
                            id,
                            nonce: nonce.clone(),
                        };
                        let worker = tokio::spawn(crate::mcp_tools::run(
                            session,
                            value,
                            input,
                            events.clone(),
                        ));
                        mcp_sockets.insert(nonce, (sender, worker));
                    }
                }
            }
            Command::McpToolResult {
                generation: expected,
                nonce,
                payload,
            } => {
                if expected == generation
                    && let Some((sender, _)) = mcp_sockets.get(&nonce)
                    && sender.send(payload).is_err()
                {
                    let _=events.send(Event::McpIpc{generation,nonce,payload:json!({"type":"error","message":"The app tool worker stopped"})}).await;
                }
            }
            Command::McpClose {
                generation: expected,
                nonce,
            } => {
                if expected == generation {
                    if let Some((_, worker)) = mcp_sockets.remove(&nonce) {
                        worker.abort();
                    }
                    let _ = events.send(Event::McpClosed { generation, nonce }).await;
                }
            }
            Command::McpExport {
                generation: expected,
                task,
                id,
                nonce,
                request,
                params,
            } => {
                if expected == generation
                    && let Some(client) = client.clone()
                {
                    let events = events.clone();
                    tokio::spawn(async move {
                        let result = crate::mcp_downloads::resolve(
                            &client, &task, &id, &nonce, &request, params,
                        )
                        .await
                        .map_err(|error| error.to_string());
                        let _ = events
                            .send(Event::McpExport {
                                generation: expected,
                                nonce,
                                request,
                                result,
                            })
                            .await;
                    });
                }
            }
            Command::Connect {
                connection,
                open_task,
            } => {
                if let Some(worker) = fleet_worker.take() {
                    worker.abort();
                }
                if let Some((_, worker)) = device.take() {
                    worker.abort();
                }
                for (_, (_, worker)) in mcp_sockets.drain() {
                    worker.abort();
                }
                generation += 1;
                client = None;
                drafts = None;
                outbox = None;
                target_tx.send_replace(None);
                for (_, (_, task)) in terminals.drain() {
                    task.abort();
                }
                match RuntimeClient::new(connection) {
                    Ok(next) => {
                        let address = next.connection.address.clone();
                        client = Some(next);
                        if events
                            .send(Event::Connected {
                                generation,
                                address,
                                open_task,
                            })
                            .await
                            .is_err()
                        {
                            break;
                        }
                        match crate::drafts::Drafts::open(
                            &storage.directory,
                            &client.as_ref().expect("connected client").connection,
                        ) {
                            Ok(store) => {
                                let _ = events
                                    .send(Event::Drafts {
                                        generation,
                                        values: store.values.clone(),
                                    })
                                    .await;
                                drafts = Some(store);
                            }
                            Err(error) => {
                                let _ = events
                                    .send(Event::Response {
                                        generation,
                                        key: "draft-storage".into(),
                                        result: Err(error.to_string()),
                                    })
                                    .await;
                            }
                        }
                        match Outbox::open(
                            &storage.directory,
                            &client.as_ref().expect("connected client").connection,
                        ) {
                            Ok(journal) => {
                                let _ = events
                                    .send(Event::Outbox {
                                        generation,
                                        messages: journal.messages.clone(),
                                    })
                                    .await;
                                outbox = Some(journal);
                            }
                            Err(error) => {
                                outbox = None;
                                let _ = events
                                    .send(Event::Response {
                                        generation,
                                        key: "outbox".into(),
                                        result: Err(error.to_string()),
                                    })
                                    .await;
                            }
                        }
                        target_tx.send_replace(Some(SyncTarget {
                            generation,
                            client: client.as_ref().expect("connected client").clone(),
                            task: None,
                        }));
                    }
                    Err(error) => {
                        let _ = events
                            .send(Event::Status {
                                generation,
                                online: false,
                                detail: error.to_string(),
                            })
                            .await;
                    }
                }
            }
            Command::SaveDraft {
                generation: expected,
                id,
                text,
            } => {
                if expected == generation {
                    let result = drafts
                        .as_mut()
                        .context("Draft storage is unavailable")
                        .and_then(|drafts| drafts.save(id, text));
                    if let Err(error) = result {
                        let _ = events
                            .send(Event::Response {
                                generation,
                                key: "draft-storage".into(),
                                result: Err(error.to_string()),
                            })
                            .await;
                    }
                }
            }
            Command::BrowserAction {
                generation: expected,
                id,
                action,
            } => {
                if generation == expected {
                    let _ = events
                        .send(Event::BrowserAction {
                            generation,
                            id,
                            action,
                        })
                        .await;
                }
            }
            Command::McpIpc {
                generation: expected,
                nonce,
                payload,
            } => {
                if generation == expected {
                    let _ = events
                        .send(Event::McpIpc {
                            generation,
                            nonce,
                            payload,
                        })
                        .await;
                }
            }
            Command::LocalRuntime => {
                let result = crate::local_runtime::attach_or_start()
                    .await
                    .map_err(|error| error.to_string());
                let _ = events.send(Event::LocalRuntime(result)).await;
            }
            Command::Disconnect => {
                if let Some(worker) = fleet_worker.take() {
                    worker.abort();
                }
                if let Some((_, worker)) = device.take() {
                    worker.abort();
                }
                for (_, (_, worker)) in mcp_sockets.drain() {
                    worker.abort();
                }
                generation += 1;
                client = None;
                outbox = None;
                drafts = None;
                for (_, (_, task)) in terminals.drain() {
                    task.abort();
                }
                target_tx.send_replace(None);
                let _ = events
                    .send(Event::Status {
                        generation,
                        online: false,
                        detail: "Disconnected".into(),
                    })
                    .await;
            }
            Command::Select(task) => {
                if let Some((_, worker)) = device.take() {
                    worker.abort();
                }
                for (_, (_, stream)) in terminals.drain() {
                    stream.abort();
                }
                if let Some(client) = &client {
                    target_tx.send_replace(Some(SyncTarget {
                        generation,
                        client: client.clone(),
                        task,
                    }));
                }
            }
            Command::ChainTask {
                generation: expected,
                id,
                source,
                before,
                draft,
            } => {
                let events = events.clone();
                let client = client.clone();
                let current = generation;
                tokio::spawn(async move {
                    let result = async {
                        ensure!(
                            expected == current,
                            "The runtime connection changed; reopen this task"
                        );
                        let client = client.context("Connect to a computer first")?;
                        chain_task(&client, &id, &source, before, draft).await
                    }
                    .await
                    .map_err(|error| error.to_string());
                    let _ = events
                        .send(Event::Response {
                            generation: expected,
                            key: format!("task-chain:{id}"),
                            result,
                        })
                        .await;
                });
            }
            Command::Request {
                generation: expected_generation,
                key,
                method,
                path,
                input,
            } => {
                if expected_generation == generation
                    && !matches!(
                        path.as_str(),
                        "/api/tasks/message"
                            | "/api/tasks/steer"
                            | "/api/jobs/run"
                            | "/api/review/task/start"
                            | "/api/review/task/fix"
                    )
                    && let Some(client) = client.clone()
                {
                    let events = events.clone();
                    tokio::spawn(async move {
                        let result = client
                            .request::<Value>(method, &path, Some(&input))
                            .await
                            .map_err(|error| error.to_string());
                        let _ = events
                            .send(Event::Response {
                                generation: expected_generation,
                                key,
                                result,
                            })
                            .await;
                    });
                    continue;
                }
                let result=async {
                    ensure!(expected_generation == generation, "The runtime connection changed; reopen this view before retrying");
                    let client=client.as_ref().context("Connect to a computer first")?;
                    let saved=matches!(path.as_str(),"/api/tasks/message"|"/api/tasks/steer"|"/api/jobs/run"|"/api/review/task/start"|"/api/review/task/fix");
                    if saved {outbox.as_mut().context("Outgoing messages could not be opened. Resolve the storage error before sending.")?.save(SavedMessage{key:key.clone(),path:path.clone(),input:input.clone()})?;}
                    let result=client.request::<Value>(method,&path,Some(&input)).await?;
                    if saved {outbox.as_mut().context("Missing message journal")?.remove(&key)?;}
                    Ok::<_,anyhow::Error>(result)
                }.await.map_err(|error|error.to_string());
                let _ = events
                    .send(Event::Response {
                        generation: expected_generation,
                        key,
                        result,
                    })
                    .await;
            }
            Command::Pair {
                address,
                code,
                name,
            } => {
                let result = async {
                    ensure!(
                        pending.is_none(),
                        "Finish or cancel the current pairing first"
                    );
                    ensure!(
                        code.len() == 8 && code.bytes().all(|byte| byte.is_ascii_digit()),
                        "Enter the eight-digit pairing code"
                    );
                    let address = normalize_address(&address)?;
                    let proof: PairingProof = public_post(
                        &address,
                        "/api/pair/request",
                        &json!({ "protocolVersion": 2, "code": code, "name": name }),
                    )
                    .await?;
                    let profile = Profile {
                        id: uuid::Uuid::new_v4().to_string(),
                        name: url::Url::parse(&address)?
                            .host_str()
                            .unwrap_or("Computer")
                            .into(),
                        address,
                    };
                    let pairing = PendingPairing {
                        profile,
                        proof,
                        token: None,
                        confirmed:false,
                    };
                    if let Err(error)=save_pending(&pairing) {
                        let cancellation=public_post::<Value>(&pairing.profile.address,"/api/pair/cancel",&serde_json::to_value(&pairing.proof)?).await;
                        match cancellation {
                            Ok(_)=>return Err(error.context("Pairing was cancelled because its proof could not be saved securely")),
                            Err(cancel)=>anyhow::bail!("Could not save the pairing proof: {error}. Host cleanup also failed: {cancel}. Decline the pending device on the host."),
                        }
                    }
                    pending = Some(pairing);
                    Ok::<_, anyhow::Error>(())
                }
                .await;
                let _ = events.send(Event::Pairing { pending: pending.is_some(), message: result.map(|()| "Approve this device on the runtime computer, then choose Check approval.".into()).unwrap_or_else(|error| error.to_string()) }).await;
            }
            Command::Claim => {
                let result = async {
                    if pending.is_none() {
                        pending = read_pending()?;
                    }
                    let pairing = pending.as_mut().context("No pairing is pending")?;
                    let expired=chrono::DateTime::parse_from_rfc3339(&pairing.proof.expires_at).context("Invalid saved pairing expiry")?<=chrono::Utc::now();
                    let token=if (pairing.confirmed||expired) && let Some(token)=pairing.token.clone() {
                        let staged=RuntimeClient::new(Connection{address:pairing.profile.address.clone(),token:token.clone()})?;
                        staged.snapshot(None).await.context("The staged credential is unavailable; check the host before recovering this pairing")?;
                        token
                    }else {
                        let claimed: Value = public_post(&pairing.profile.address,"/api/pair/claim",&serde_json::to_value(&pairing.proof)?).await?;
                        match claimed.get("status").and_then(Value::as_str) {
                            Some("pending") => return Ok(None),
                            Some("denied") => anyhow::bail!("The host declined this pairing request"),
                            Some("approved") => {},
                            _ => anyhow::bail!("Invalid pairing response"),
                        }
                        let token=claimed.get("token").and_then(Value::as_str).context("Missing paired device token")?.to_owned();
                        pairing.token=Some(token.clone());save_pending(pairing)?;
                        let _:Value=public_post(&pairing.profile.address,"/api/pair/confirm",&serde_json::to_value(&pairing.proof)?).await?;
                        pairing.confirmed=true;save_pending(pairing)?;
                        token
                    };
                    // Commit metadata after confirmation, retaining the staged credential until all writes succeed.
                    storage.save_token(&pairing.profile, &token)?;
                    let mut registry = storage.read()?;
                    registry
                        .profiles
                        .retain(|profile| profile.id != pairing.profile.id);
                    registry.profiles.push(pairing.profile.clone());
                    registry.active_id = Some(pairing.profile.id.clone());
                    storage.write(&registry)?;
                    clear_pending()?;
                    let connection = Connection {
                        address: pairing.profile.address.clone(),
                        token,
                    };
                    Ok::<_, anyhow::Error>(Some((registry, connection)))
                }
                .await;
                match result {
                    Ok(Some((registry, connection))) => {
                        pending = None;
                        let _ = events
                            .send(Event::Paired {
                                registry,
                                connection,
                            })
                            .await;
                    }
                    Ok(None) => {
                        let _ = events
                            .send(Event::Pairing {
                                pending: true,
                                message: "Waiting for host approval.".into(),
                            })
                            .await;
                    }
                    Err(error) => {
                        let _ = events
                            .send(Event::Pairing {
                                pending: pending.is_some(),
                                message: error.to_string(),
                            })
                            .await;
                    }
                }
            }
            Command::CancelPairing => {
                let result = async {
                    if pending.is_none() {
                        pending = read_pending()?;
                    }
                    if let Some(pairing) = &pending {
                        let cancellation: Result<Value> = public_post(
                            &pairing.profile.address,
                            "/api/pair/cancel",
                            &serde_json::to_value(&pairing.proof)?,
                        ).await;
                        if let Err(error) = cancellation {
                            let token = pairing.token.clone().with_context(|| format!("Could not cancel pairing: {error}"))?;
                            let paired = RuntimeClient::new(Connection {
                                address: pairing.profile.address.clone(), token,
                            })?;
                            let _: Value = paired.post("/api/devices/revoke-self", &json!({})).await
                                .context("Could not revoke the staged pairing credential; local recovery data has been preserved")?;
                        }
                    }
                    if let Some(pairing) = &pending {
                        let mut registry = storage.read()?;
                        registry
                            .profiles
                            .retain(|profile| profile.id != pairing.profile.id);
                        if registry.active_id.as_deref() == Some(&pairing.profile.id) {
                            registry.active_id = None;
                        }
                        storage.write(&registry)?;
                        storage.forget(&pairing.profile)?;
                        let _ = events.send(Event::Registry(registry)).await;
                    }
                    clear_pending()?;
                    Ok::<_, anyhow::Error>(())
                }
                .await;
                if result.is_ok() {
                    pending = None;
                }
                let _ = events
                    .send(Event::Pairing {
                        pending: pending.is_some(),
                        message: result
                            .map(|()| "Pairing cancelled".into())
                            .unwrap_or_else(|error| error.to_string()),
                    })
                    .await;
            }
            Command::DeviceOpen {
                generation: expected,
                id,
                ticket,
            } => {
                if expected != generation {
                    continue;
                }
                if let Some((_, worker)) = device.take() {
                    worker.abort();
                }
                if let Some(client) = client.clone() {
                    let (sender, receiver) = mpsc::channel(128);
                    let events = events.clone();
                    let worker = tokio::spawn(async move {
                        if let Err(error) = crate::device_preview::stream(
                            client,
                            generation,
                            id.clone(),
                            ticket,
                            receiver,
                            events.clone(),
                        )
                        .await
                        {
                            let _ = events
                                .send(Event::Response {
                                    generation,
                                    key: format!("device-stream:{id}"),
                                    result: Err(error.to_string()),
                                })
                                .await;
                        }
                        let _ = events.send(Event::DeviceClosed { generation, id }).await;
                    });
                    device = Some((sender, worker));
                }
            }
            Command::DeviceInput {
                generation: expected,
                input,
            } => {
                if expected == generation
                    && let Some((sender, _)) = &device
                    && let Err(error) = sender.try_send(input)
                {
                    let _ = events
                        .send(Event::Response {
                            generation,
                            key: "device-input".into(),
                            result: Err(format!("Device input could not be sent: {error}")),
                        })
                        .await;
                }
            }
            Command::DeviceClose => {
                if let Some((_, worker)) = device.take() {
                    worker.abort();
                }
            }
            Command::DetachTerminals => {
                for (_, (_, task)) in terminals.drain() {
                    task.abort();
                }
            }
            Command::OpenTerminal(id) => {
                if terminals
                    .get(&id)
                    .is_some_and(|(_, task)| !task.is_finished())
                {
                    continue;
                }
                if let Some(client) = client.clone() {
                    let (input, receiver) = mpsc::channel(256);
                    let terminal_events = events.clone();
                    let terminal_id = id.clone();
                    let task = tokio::spawn(async move {
                        if let Err(error) = terminal_stream(
                            client,
                            generation,
                            terminal_id.clone(),
                            receiver,
                            terminal_events.clone(),
                        )
                        .await
                        {
                            let _ = terminal_events
                                .send(Event::Response {
                                    generation,
                                    key: format!("terminal-stream:{terminal_id}"),
                                    result: Err(error.to_string()),
                                })
                                .await;
                        }
                    });
                    terminals.insert(id, (input, task));
                }
            }
            command @ (Command::TerminalInput { .. } | Command::TerminalBytesInput { .. }) => {
                let (id, value) = match command {
                    Command::TerminalInput { id, data } => {
                        (id, json!({"type":"input","data":data}))
                    }
                    Command::TerminalBytesInput { id, data } => (
                        id,
                        json!({"type":"input-bytes","data":STANDARD.encode(data)}),
                    ),
                    _ => unreachable!(),
                };
                if let Some((sender, _)) = terminals.get(&id)
                    && sender.try_send(value).is_err()
                {
                    let _ = events
                        .send(Event::Response {
                            generation,
                            key: format!("terminal-input:{id}"),
                            result: Err(
                                "Terminal input queue is full or disconnected. This input was not sent.".into()
                            ),
                        })
                        .await;
                }
            }
            Command::TerminalResize { id, rows, cols } => {
                if let Some((sender, _)) = terminals.get(&id) {
                    let _ = sender
                        .send(json!({"type":"resize","rows":rows,"cols":cols}))
                        .await;
                }
            }
            Command::RetryMessage(key) => {
                let result = async {
                    let journal = outbox.as_mut().context("No saved outgoing messages")?;
                    let message = journal
                        .messages
                        .iter()
                        .find(|message| message.key == key)
                        .cloned()
                        .context("The saved message is no longer pending")?;
                    let result = client
                        .as_ref()
                        .context("Reconnect the original computer before retrying")?
                        .post::<Value>(&message.path, &message.input)
                        .await?;
                    journal.remove(&key)?;
                    Ok::<_, anyhow::Error>(result)
                }
                .await
                .map_err(|error| error.to_string());
                let _ = events
                    .send(Event::Response {
                        generation,
                        key,
                        result,
                    })
                    .await;
            }
            Command::DiscardMessage(key) => {
                let result = outbox
                    .as_mut()
                    .context("No saved outgoing messages")
                    .and_then(|journal| journal.remove(&key))
                    .map(|()| json!({"discarded":true}))
                    .map_err(|error| error.to_string());
                let _ = events
                    .send(Event::Response {
                        generation,
                        key,
                        result,
                    })
                    .await;
            }
        }
    }
    sync.abort();
    if let Some(worker) = fleet_worker {
        worker.abort();
    }
    for (_, (_, task)) in terminals {
        task.abort();
    }
}

pub(crate) async fn chain_task(
    client: &RuntimeClient,
    id: &str,
    source: &str,
    before: String,
    draft: String,
) -> Result<Value> {
    if draft != before {
        let patch = crate::model::WorkspacePatch::update(
            "tasks",
            id.to_owned(),
            "draft",
            json!(before),
            json!(draft),
        );
        client
            .request::<Value>(
                Method::PATCH,
                "/api/workspace",
                Some(&serde_json::to_value(patch)?),
            )
            .await
            .context("The request could not be saved; the task was not chained")?;
    }
    client
        .post(
            "/api/tasks/start-after",
            &json!({"id":id,"sourceId":source}),
        )
        .await
}

async fn terminal_stream(
    client: RuntimeClient,
    generation: u64,
    id: String,
    mut input: mpsc::Receiver<Value>,
    events: async_channel::Sender<Event>,
) -> Result<()> {
    let mut size = json!({"type":"resize","rows":30,"cols":100});
    let mut delay = 1;
    loop {
        let connected_at = std::time::Instant::now();
        let result =
            terminal_connection(&client, generation, &id, &mut input, &events, &mut size).await;
        if input.is_closed() {
            return Ok(());
        }
        if connected_at.elapsed() >= Duration::from_secs(30) {
            delay = 1;
        }
        let detail = result
            .err()
            .map(|error| error.to_string())
            .unwrap_or_else(|| "Terminal connection closed".into());
        events
            .send(Event::Response {
                generation,
                key: format!("terminal-stream:{id}"),
                result: Err(format!("{detail}. Reconnecting…")),
            })
            .await?;
        let pause = tokio::time::sleep(Duration::from_secs(delay));
        tokio::pin!(pause);
        loop {
            tokio::select! {
                biased;
                command = input.recv() => match command {
                    None => return Ok(()),
                    Some(value) if value["type"] == "resize" => size = value,
                    Some(_) => { events.send(Event::Response { generation, key: format!("terminal-input:{id}"), result: Err("Terminal is reconnecting. Input was not sent.".into()) }).await?; }
                },
                _ = &mut pause => break,
            }
        }
        delay = (delay * 2).min(16);
    }
}

async fn terminal_connection(
    client: &RuntimeClient,
    generation: u64,
    id: &str,
    input: &mut mpsc::Receiver<Value>,
    events: &async_channel::Sender<Event>,
    size: &mut Value,
) -> Result<()> {
    #[derive(Deserialize)]
    struct Ticket {
        ticket: String,
        #[serde(default, rename = "byteInput")]
        byte_input: bool,
    }
    let connect = async {
        let ticket: Ticket = client
            .post("/api/terminals/ticket", &json!({"id":id}))
            .await?;
        let url = client.websocket_url("/ws/terminal", &ticket.ticket)?;
        let connection = connect_async(url.as_str())
            .await
            .map_err(|_| anyhow::anyhow!("Cannot connect to the terminal"))?;
        Ok::<_, anyhow::Error>((connection, ticket.byte_input))
    };
    tokio::pin!(connect);
    let ((mut socket, _), byte_input) = loop {
        tokio::select! {
            biased;
            command = input.recv() => match command {
                None => return Ok(()),
                Some(value) if value["type"] == "resize" => *size = value,
                Some(_) => { events.send(Event::Response { generation, key: format!("terminal-input:{id}"), result: Err("Terminal is connecting. Input was not sent.".into()) }).await?; }
            },
            connection = &mut connect => break connection?,
        }
    };
    events
        .send(Event::TerminalStarted {
            generation,
            id: id.to_string(),
        })
        .await?;
    socket.send(Message::Text(size.to_string().into())).await?;
    loop {
        tokio::select! {
            command = input.recv() => {
                match command {
                    Some(value) => {
                        if value["type"] == "resize" { *size = value.clone(); }
                        match terminal_input_frame(value, byte_input) {
                            Ok(value) => socket.send(Message::Text(value.to_string().into())).await?,
                            Err(error) => events.send(Event::Response { generation, key: format!("terminal-input:{id}"), result: Err(error.to_string()) }).await?,
                        }
                    },
                    None => return Ok(())
                }
            }
            frame = socket.next() => {
                match frame.context("Terminal connection closed")?? {
                    Message::Text(text) => events.send(Event::TerminalData { generation, id: id.to_string(), data: text.as_bytes().to_vec() }).await?,
                    Message::Binary(bytes) => events.send(Event::TerminalData { generation, id: id.to_string(), data: bytes.to_vec() }).await?,
                    Message::Ping(payload) => socket.send(Message::Pong(payload)).await?,
                    Message::Close(_) => return Ok(()),
                    _ => {}
                }
            }
        }
    }
}

fn terminal_input_frame(value: Value, byte_input: bool) -> Result<Value> {
    if value["type"] != "input-bytes" || byte_input {
        return Ok(value);
    }
    let bytes = STANDARD.decode(value["data"].as_str().context("Missing terminal bytes")?)?;
    let text = String::from_utf8(bytes).context(
        "This runtime does not support legacy mouse bytes at these coordinates. Update the runtime or use a terminal application with SGR mouse mode. This input was not sent.",
    )?;
    Ok(json!({"type":"input", "data":text}))
}

fn pending_entry() -> Result<keyring::Entry> {
    Ok(keyring::Entry::new(
        "dev.dovo.studio.gpui",
        "pending-pairing",
    )?)
}
fn save_pending(pairing: &PendingPairing) -> Result<()> {
    pending_entry()?
        .set_password(&serde_json::to_string(pairing)?)
        .context("Could not securely save pairing progress")
}
fn read_pending() -> Result<Option<PendingPairing>> {
    match pending_entry()?.get_password() {
        Ok(text) => Ok(Some(serde_json::from_str(&text)?)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.into()),
    }
}
fn clear_pending() -> Result<()> {
    match pending_entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.into()),
    }
}

async fn synchronize(
    mut targets: watch::Receiver<Option<SyncTarget>>,
    events: async_channel::Sender<Event>,
) {
    loop {
        let target = targets.borrow_and_update().clone();
        if let Some(target) = target {
            let mut replica = Replica::default();
            let mut delay = 1;
            loop {
                tokio::select! {
                    biased;
                    changed = targets.changed() => { if changed.is_err() { return; } break; }
                    result = stream(&target, &mut replica, &events) => {
                        let detail = result.err().map(|error| error.to_string()).unwrap_or_else(|| "The runtime connection closed".into());
                        if events.send(Event::Status { generation: target.generation, online: false, detail: format!("{detail}. Reconnecting…") }).await.is_err() { return; }
                        // A broken delta must request a new authoritative snapshot.
                        replica = Replica::default();
                    }
                }
                tokio::select! {
                    changed = targets.changed() => { if changed.is_err() { return; } break; }
                    _ = tokio::time::sleep(Duration::from_secs(delay)) => {}
                }
                delay = (delay * 2).min(16);
            }
        } else if targets.changed().await.is_err() {
            return;
        }
    }
}

async fn stream(
    target: &SyncTarget,
    replica: &mut Replica,
    events: &async_channel::Sender<Event>,
) -> Result<()> {
    let path = {
        let mut query = url::form_urlencoded::Serializer::new(String::new());
        query
            .append_pair("format", "4")
            .append_pair("history", "paged");
        if let Some(task) = &target.task {
            query.append_pair("task", task);
        }
        format!("/api/sync/ticket?{}", query.finish())
    };
    #[derive(Deserialize)]
    struct Ticket {
        ticket: String,
    }
    let ticket: Ticket = target.client.post(&path, &json!({})).await?;
    let url = target.client.websocket_url("/ws/sync", &ticket.ticket)?;
    // Do not include the URL in errors: it contains the socket ticket.
    let (mut socket, _) = connect_async(url.as_str())
        .await
        .map_err(|_| anyhow::anyhow!("Cannot open the runtime stream"))?;
    socket
        .send(Message::Text(replica.resume().to_string().into()))
        .await?;
    if let Some(task) = &target.task {
        socket
            .send(Message::Text(
                json!({"type":"watch","tasks":[task],"scopes":[task],"detailScopes":[task]})
                    .to_string()
                    .into(),
            ))
            .await?;
    }
    let mut heartbeat = tokio::time::interval(Duration::from_secs(15));
    let mut last_seen = tokio::time::Instant::now();
    loop {
        tokio::select! {
            _ = heartbeat.tick() => {
                ensure!(last_seen.elapsed() < Duration::from_secs(45), "The runtime stream stopped responding");
                socket.send(Message::Ping(Vec::new().into())).await?;
            }
            incoming = socket.next() => {
                let frame = incoming.context("Runtime connection closed")??;
                last_seen = tokio::time::Instant::now();
                match frame {
                    Message::Text(text) => {
                        let frame:Value = serde_json::from_str(&text).context("Invalid runtime sync frame")?;
                        let activity_scope=if matches!(frame.get("type").and_then(Value::as_str),Some("activity"|"activity-delta")) {frame.get("scope").and_then(Value::as_str).map(str::to_owned)}else{None};
                        if let Some(snapshot) = replica.apply(frame)? {
                            events.send(Event::Snapshot { generation: target.generation, task: target.task.clone(), snapshot: Box::new(snapshot) }).await?;
                            events.send(Event::Status { generation: target.generation, online: true, detail: "Connected".into() }).await?;
                        }
                        if let Some(scope)=activity_scope
                            && target.task.as_deref()==Some(&scope) {
                                let activity=replica.activity.get(&scope).context("Missing activity result")?;
                                events.send(Event::Activity{generation:target.generation,task:scope,events:serde_json::from_value(activity.clone())?}).await?;
                            }
                    }
                    Message::Ping(payload) => socket.send(Message::Pong(payload)).await?,
                    Message::Close(_) => anyhow::bail!("Runtime connection closed"),
                    _ => {}
                }
            }
        }
    }
}

#[cfg(test)]
mod terminal_tests {
    use super::*;
    use std::io::{Read, Write};

    #[test]
    fn terminal_bytes_require_capability_or_lossless_text_fallback() {
        let frame = |bytes: &[u8]| json!({"type":"input-bytes", "data": STANDARD.encode(bytes)});
        let high_bytes = frame(b"\x1b[M \xff\xb7");
        assert_eq!(
            terminal_input_frame(high_bytes.clone(), true).unwrap(),
            high_bytes
        );
        assert!(
            terminal_input_frame(high_bytes, false)
                .unwrap_err()
                .to_string()
                .contains("not sent")
        );
        for bytes in [
            b"\x1b[M &#".as_slice(),
            "\x1b[M \u{b7}#".as_bytes(),
            b"\x1b[<0;151;3M",
        ] {
            let text = terminal_input_frame(frame(bytes), false).unwrap();
            assert_eq!(text["type"], "input");
            assert_eq!(text["data"].as_str().unwrap().as_bytes(), bytes);
        }
    }

    #[tokio::test]
    async fn chaining_saves_the_draft_first_and_stops_on_conflict() {
        for conflict in [false, true] {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let address = listener.local_addr().unwrap();
            let server = std::thread::spawn(move || {
                for step in 0..if conflict { 1 } else { 2 } {
                    let (mut socket, _) = listener.accept().unwrap();
                    socket
                        .set_read_timeout(Some(Duration::from_secs(5)))
                        .unwrap();
                    let mut bytes = Vec::new();
                    let mut buffer = [0; 4096];
                    loop {
                        let count = socket.read(&mut buffer).unwrap();
                        assert!(count > 0);
                        bytes.extend_from_slice(&buffer[..count]);
                        if let Some(end) = bytes.windows(4).position(|window| window == b"\r\n\r\n")
                        {
                            let headers = String::from_utf8_lossy(&bytes[..end]);
                            let length: usize = headers
                                .lines()
                                .find_map(|line| {
                                    line.to_lowercase()
                                        .strip_prefix("content-length: ")
                                        .map(str::to_owned)
                                })
                                .unwrap()
                                .parse()
                                .unwrap();
                            if bytes.len() >= end + 4 + length {
                                break;
                            }
                        }
                    }
                    let end = bytes
                        .windows(4)
                        .position(|window| window == b"\r\n\r\n")
                        .unwrap();
                    let headers = String::from_utf8_lossy(&bytes[..end]);
                    let body: Value = serde_json::from_slice(&bytes[end + 4..]).unwrap();
                    if step == 0 {
                        assert!(headers.starts_with("PATCH /api/workspace"));
                        assert_eq!(body["changes"]["draft"]["before"], "old");
                        assert_eq!(body["changes"]["draft"]["after"], "local request");
                    } else {
                        assert!(headers.starts_with("POST /api/tasks/start-after"));
                        assert_eq!(body, json!({"id":"target","sourceId":"source"}));
                    }
                    let status = if conflict { "409 Conflict" } else { "200 OK" };
                    let body = if conflict {
                        r#"{"error":"draft changed"}"#
                    } else {
                        r#"{"ok":true}"#
                    };
                    write!(socket, "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
                }
            });
            let client = RuntimeClient::new(Connection {
                address: format!("http://{address}"),
                token: "device-token".into(),
            })
            .unwrap();
            let result = chain_task(
                &client,
                "target",
                "source",
                "old".into(),
                "local request".into(),
            )
            .await;
            assert_eq!(result.is_err(), conflict);
            if conflict {
                assert!(
                    result
                        .unwrap_err()
                        .to_string()
                        .contains("task was not chained")
                );
            }
            server.join().unwrap();
        }
    }

    #[tokio::test]
    async fn reconnects_with_a_fresh_ticket_and_retains_resize() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let runtime = tokio::runtime::Runtime::new().unwrap();
            for attempt in 0..2 {
                let (mut http, _) = listener.accept().unwrap();
                http.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
                let mut request = [0; 4096];
                let length = http.read(&mut request).unwrap();
                let request = String::from_utf8_lossy(&request[..length]);
                assert!(request.starts_with("POST /api/terminals/ticket"));
                let body = r#"{"ticket":"test-ticket"}"#;
                write!(http, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
                drop(http);
                let (socket, _) = listener.accept().unwrap();
                socket.set_nonblocking(true).unwrap();
                runtime.block_on(async {
                    let socket = tokio::net::TcpStream::from_std(socket).unwrap();
                    let mut socket = tokio_tungstenite::accept_async(socket).await.unwrap();
                    let resize = socket.next().await.unwrap().unwrap();
                    let resize: Value = serde_json::from_str(resize.to_text().unwrap()).unwrap();
                    assert_eq!(resize["rows"], if attempt == 0 { 30 } else { 42 });
                    assert_eq!(resize["cols"], if attempt == 0 { 100 } else { 120 });
                    if attempt == 0 {
                        let resize = socket.next().await.unwrap().unwrap();
                        let resize: Value =
                            serde_json::from_str(resize.to_text().unwrap()).unwrap();
                        assert_eq!(resize["rows"], 42);
                        socket.close(None).await.unwrap();
                    } else {
                        socket
                            .send(Message::Text("replayed output".into()))
                            .await
                            .unwrap();
                        let _ = socket.next().await;
                    }
                });
            }
        });
        let client = RuntimeClient::new(Connection {
            address: format!("http://{address}"),
            token: "device-token".into(),
        })
        .unwrap();
        let (sender, input) = mpsc::channel(16);
        let (events, receiver) = async_channel::bounded(16);
        let worker = tokio::spawn(terminal_stream(client, 1, "terminal".into(), input, events));
        tokio::time::timeout(Duration::from_secs(10), async {
            assert!(matches!(
                receiver.recv().await.unwrap(),
                Event::TerminalStarted { .. }
            ));
            sender
                .send(json!({"type":"resize","rows":42,"cols":120}))
                .await
                .unwrap();
            assert!(matches!(
                receiver.recv().await.unwrap(),
                Event::Response { .. }
            ));
            sender
                .send(json!({"type":"input","data":"do not replay"}))
                .await
                .unwrap();
            match receiver.recv().await.unwrap() {
                Event::Response { key, result, .. } => {
                    assert_eq!(key, "terminal-input:terminal");
                    assert!(result.unwrap_err().contains("not sent"));
                }
                _ => panic!("Expected disconnected input rejection"),
            }
            assert!(matches!(
                receiver.recv().await.unwrap(),
                Event::TerminalStarted { .. }
            ));
            match receiver.recv().await.unwrap() {
                Event::TerminalData { data, .. } => assert_eq!(data, b"replayed output"),
                _ => panic!("Expected replay output"),
            }
            drop(sender);
            worker.await.unwrap().unwrap();
        })
        .await
        .unwrap();
        server.join().unwrap();
    }
}
