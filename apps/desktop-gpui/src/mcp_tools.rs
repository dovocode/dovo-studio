use crate::{connection::RuntimeClient, service::Event};
use anyhow::{Context, Result, ensure};
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use std::{collections::HashSet, time::Duration};
use tokio::sync::mpsc;
use tokio_tungstenite::{connect_async, tungstenite::Message};

pub struct Session {
    pub client: RuntimeClient,
    pub generation: u64,
    pub task: String,
    pub id: String,
    pub nonce: String,
}
pub async fn run(
    session: Session,
    mut tools: Value,
    mut input: mpsc::UnboundedReceiver<Value>,
    events: async_channel::Sender<Event>,
) {
    let Session {
        generation, nonce, ..
    } = &session;
    let mut delay = 1;
    loop {
        let result = stream(&session, &mut tools, &mut input, &events).await;
        if input.is_closed() {
            return;
        }
        let detail = result
            .err()
            .map(|error| error.to_string())
            .unwrap_or_else(|| "MCP app tools disconnected".into());
        if events
            .send(Event::McpIpc {
                generation: *generation,
                nonce: nonce.clone(),
                payload: json!({"type":"notice","message":format!("{detail}; reconnecting")}),
            })
            .await
            .is_err()
        {
            return;
        }
        tokio::select! {
            _=tokio::time::sleep(Duration::from_secs(delay))=>{},
            command=input.recv()=>match command {Some(value) if value.get("type").and_then(Value::as_str)==Some("tools")=>tools=value,Some(_)=>{},None=>return},
        }
        delay = (delay * 2).min(16);
    }
}
async fn stream(
    session: &Session,
    tools: &mut Value,
    input: &mut mpsc::UnboundedReceiver<Value>,
    events: &async_channel::Sender<Event>,
) -> Result<()> {
    let Session {
        client,
        generation,
        task,
        id,
        nonce,
    } = session;
    let ticket: Value = client
        .post("/api/mcp-apps/ticket", &json!({"taskId":task,"id":id}))
        .await?;
    let url = client.websocket_url(
        "/ws/mcp-app",
        ticket
            .get("ticket")
            .and_then(Value::as_str)
            .context("Missing MCP tool ticket")?,
    )?;
    let (mut socket, _) = connect_async(url.as_str())
        .await
        .map_err(|_| anyhow::anyhow!("Cannot open the MCP app tool stream"))?;
    socket.send(Message::Text(tools.to_string().into())).await?;
    let mut pending = HashSet::new();
    let result=async {
        loop {
            tokio::select! {
                command=input.recv()=>{
                    let value=command.context("MCP app closed")?;
                    let kind=value.get("type").and_then(Value::as_str);
                    if kind==Some("tools"){*tools=value.clone();}
                    if kind==Some("result") && !value.get("requestId").and_then(Value::as_str).is_some_and(|id|pending.remove(id)){continue;}
                    socket.send(Message::Text(value.to_string().into())).await?;
                }
                message=socket.next()=>{
                    match message.context("MCP app disconnected")?? {
                        Message::Text(text)=>{
                            let value:Value=serde_json::from_str(&text)?;
                            let request=value.get("requestId").and_then(Value::as_str).context("Missing app tool request ID")?;
                            match value.get("type").and_then(Value::as_str) {
                                Some("call")=>{ensure!(pending.len()<16,"Too many pending app tool calls");pending.insert(request.to_owned());}
                                Some("cancel")=>{pending.remove(request);}
                                _=>anyhow::bail!("Invalid app tool stream message"),
                            }
                            events.send(Event::McpToolMessage{generation:*generation,nonce:nonce.to_owned(),payload:value}).await?;
                        }
                        Message::Ping(bytes)=>socket.send(Message::Pong(bytes)).await?,
                        Message::Close(_)=>anyhow::bail!("MCP app disconnected"),
                        _=>{}
                    }
                }
            }
        }
    }.await;
    for request in pending {
        events
            .send(Event::McpToolMessage {
                generation: *generation,
                nonce: nonce.to_owned(),
                payload: json!({"type":"cancel","requestId":request}),
            })
            .await?;
    }
    result
}
