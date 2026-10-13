use super::*;

pub(super) struct McpSession {
    pub window: WindowHandle<crate::web_content::WebWindow>,
    pub task: String,
    pub id: String,
}
#[derive(Clone)]
pub(super) struct McpPrompt {
    pub nonce: String,
    pub payload: Value,
}
impl Workbench {
    pub(super) fn mcp_reply(
        &mut self,
        nonce: &str,
        request: &str,
        result: Result<Value, String>,
        cx: &mut Context<Self>,
    ) {
        let Some(session) = self.mcp_windows.get(nonce) else {
            return;
        };
        let mut reply = json!({"type":"reply","nonce":nonce,"requestId":request});
        match result {
            Ok(value) => reply["result"] = value,
            Err(error) => reply["error"] = json!(error),
        };
        let script = format!("window.dovoMcpReply({});", reply);
        if let Err(error) = session
            .window
            .update(cx, |view, _, cx| -> anyhow::Result<()> {
                let view = view
                    .view
                    .as_ref()
                    .ok_or_else(|| anyhow::anyhow!("The MCP view could not be opened"))?;
                view.read(cx).raw().evaluate_script(&script)?;
                Ok(())
            })
            .and_then(|result| result)
        {
            self.error = Some(error.to_string());
        }
    }
    pub(super) fn mcp_perform(&mut self, prompt: McpPrompt, cx: &mut Context<Self>) {
        let Some(session) = self.mcp_windows.get(&prompt.nonce) else {
            return;
        };
        let Some(method) = prompt.payload.get("method").and_then(Value::as_str) else {
            return;
        };
        let Some(request) = prompt.payload.get("requestId").and_then(Value::as_str) else {
            return;
        };
        let mut params = prompt.payload.get("params").cloned().unwrap_or(json!({}));
        match method {
            "ui/open-link" | "ui/open-embedded" => {
                let result = (|| -> Result<Value, String> {
                    let raw = params
                        .get("url")
                        .and_then(Value::as_str)
                        .ok_or("Missing app URL")?;
                    let url = url::Url::parse(raw).map_err(|error| error.to_string())?;
                    if !matches!(url.scheme(), "http" | "https")
                        || !url.username().is_empty()
                        || url.password().is_some()
                    {
                        return Err("Unsupported app URL".into());
                    }
                    if method == "ui/open-link" {
                        cx.open_url(raw);
                    } else {
                        session
                            .window
                            .update(cx, |view, _, _| {
                                view.allowed_origins
                                    .borrow_mut()
                                    .insert(url.origin().ascii_serialization())
                            })
                            .map_err(|error| error.to_string())?;
                    }
                    Ok(json!({}))
                })();
                self.mcp_reply(&prompt.nonce, request, result, cx);
                return;
            }
            "ui/download-file" => {
                self.command(Command::McpExport {
                    generation: self.generation,
                    task: session.task.clone(),
                    id: session.id.clone(),
                    nonce: prompt.nonce,
                    request: request.to_owned(),
                    params,
                });
                return;
            }
            "ui/cancel" => {
                let id = params
                    .get("requestId")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                params = json!({"requestId":format!("{}_{}",prompt.nonce,id)});
            }
            _ => {}
        }
        let input = json!({"taskId":session.task,"id":session.id,"requestId":format!("{}_{}",prompt.nonce,request),"method":method,"params":params});
        self.request(
            format!("mcp-rpc:{}:{}", prompt.nonce, request),
            "/api/mcp-apps/rpc",
            input,
        );
    }
    pub(super) fn mcp_event(&mut self, nonce: String, payload: Value, cx: &mut Context<Self>) {
        if !self.mcp_windows.contains_key(&nonce) {
            return;
        }
        match payload.get("type").and_then(Value::as_str) {
            Some("app-tools") => {
                if let Some(session) = self.mcp_windows.get(&nonce)
                    && let Some(tools) = payload.get("tools").filter(|value| value.is_array())
                {
                    self.command(Command::McpTools {
                        generation: self.generation,
                        task: session.task.clone(),
                        id: session.id.clone(),
                        nonce,
                        tools: tools.clone(),
                    });
                }
            }
            Some("app-tool-result") => {
                let mut payload = payload;
                payload["type"] = json!("result");
                self.command(Command::McpToolResult {
                    generation: self.generation,
                    nonce,
                    payload,
                });
            }
            Some("error" | "notice") => {
                self.notice = payload
                    .get("message")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            }
            Some("request") => {
                if !payload.get("requestId").is_some_and(Value::is_string) {
                    return;
                }
                let prompt = McpPrompt { nonce, payload };
                let method = prompt
                    .payload
                    .get("method")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if matches!(
                    method,
                    "ui/open-link"
                        | "ui/open-embedded"
                        | "ui/message"
                        | "ui/intent"
                        | "ui/download-file"
                ) {
                    if self.mcp_prompts.len() < 16 {
                        self.mcp_prompts.push(prompt);
                        cx.activate(true);
                    } else {
                        let request = prompt.payload["requestId"].as_str().unwrap();
                        self.mcp_reply(
                            &prompt.nonce,
                            request,
                            Err("Too many pending confirmations".into()),
                            cx,
                        );
                    }
                } else {
                    self.mcp_perform(prompt, cx);
                }
            }
            _ => {}
        }
    }
    pub(super) fn open_mcp_result(
        &mut self,
        value: &Value,
        cx: &mut Context<Self>,
    ) -> anyhow::Result<()> {
        let app = value
            .get("app")
            .ok_or_else(|| anyhow::anyhow!("Missing MCP app"))?;
        let task = app
            .get("taskId")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow::anyhow!("Missing MCP task"))?
            .to_owned();
        let id = app
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow::anyhow!("Missing MCP app ID"))?
            .to_owned();
        let title = app
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or("MCP app");
        let nonce = uuid::Uuid::new_v4().to_string();
        let expected = nonce.clone();
        let service = self.service.clone();
        let generation = self.generation;
        let close_service = service.clone();
        let close_nonce = nonce.clone();
        let window = crate::web_content::open_mcp(
            title,
            app.clone(),
            nonce.clone(),
            move |payload| {
                if let Err(error) = service.send(Command::McpIpc {
                    generation,
                    nonce: expected.clone(),
                    payload,
                }) {
                    eprintln!("MCP bridge closed: {error}");
                }
            },
            move || {
                if let Err(error) = close_service.send(Command::McpClose {
                    generation,
                    nonce: close_nonce.clone(),
                }) {
                    eprintln!("Could not close MCP session: {error}");
                }
            },
            cx,
        )?;
        self.mcp_windows
            .insert(nonce, McpSession { window, task, id });
        Ok(())
    }
    pub(super) fn mcp_confirmation(&mut self, cx: &mut Context<Self>) -> Option<AnyElement> {
        let prompt = self.mcp_prompts.first()?.clone();
        let method = prompt.payload["method"].as_str().unwrap_or("App action");
        let details = prompt
            .payload
            .get("params")
            .map(Value::to_string)
            .unwrap_or_default();
        Some(
            div()
                .p_4()
                .bg(cx.theme().muted)
                .flex()
                .flex_col()
                .gap_2()
                .child(format!("MCP app requests {method}"))
                .child(details.chars().take(1000).collect::<String>())
                .child(
                    div()
                        .flex()
                        .gap_2()
                        .child(Button::new("mcp-allow").primary().label("Allow").on_click(
                            cx.listener(|this, _, _, cx| {
                                let prompt = this.mcp_prompts.remove(0);
                                this.mcp_perform(prompt, cx);
                                cx.notify();
                            }),
                        ))
                        .child(
                            Button::new("mcp-decline")
                                .label("Decline")
                                .on_click(cx.listener(|this, _, _, cx| {
                                    let prompt = this.mcp_prompts.remove(0);
                                    if let Some(request) = prompt.payload["requestId"].as_str() {
                                        this.mcp_reply(
                                            &prompt.nonce,
                                            request,
                                            Err("Declined".into()),
                                            cx,
                                        );
                                    }
                                    cx.notify();
                                })),
                        ),
                )
                .into_any_element(),
        )
    }
}

impl Workbench {
    pub(super) fn save_mcp_exports(
        &mut self,
        nonce: String,
        request: String,
        files: Vec<crate::mcp_downloads::Export>,
        cx: &mut Context<Self>,
    ) {
        let generation = self.generation;
        cx.spawn(async move |this, cx| {
            let result = async {
                for file in files {
                    let picker = this.update(cx, |this, cx| -> anyhow::Result<_> {
                        anyhow::ensure!(
                            this.generation == generation && this.mcp_windows.contains_key(&nonce),
                            "The app connection changed"
                        );
                        let base = directories::UserDirs::new()
                            .map(|dirs| dirs.download_dir().unwrap_or(dirs.home_dir()).to_owned())
                            .ok_or_else(|| {
                                anyhow::anyhow!("Cannot find the downloads directory")
                            })?;
                        Ok(cx.prompt_for_new_path(&base, Some(&file.name)))
                    })??;
                    let path = picker
                        .await??
                        .ok_or_else(|| anyhow::anyhow!("Download cancelled"))?;
                    this.update(cx, |this, _| {
                        anyhow::ensure!(
                            this.generation == generation && this.mcp_windows.contains_key(&nonce),
                            "The app connection changed"
                        );
                        Ok(())
                    })??;
                    cx.background_executor()
                        .spawn(async move { std::fs::write(path, file.bytes) })
                        .await?;
                }
                Ok::<_, anyhow::Error>(json!({}))
            }
            .await
            .map_err(|error| error.to_string());
            let _ = this.update(cx, |this, cx| {
                if this.generation == generation {
                    this.mcp_reply(&nonce, &request, result, cx);
                }
            });
        })
        .detach();
    }
}

impl Workbench {
    pub(super) fn mcp_tool_message(
        &mut self,
        nonce: String,
        mut payload: Value,
        cx: &mut Context<Self>,
    ) {
        let Some(session) = self.mcp_windows.get(&nonce) else {
            return;
        };
        payload["nonce"] = json!(nonce);
        payload["type"] = json!(if payload["type"] == "call" {
            "app-tool-call"
        } else {
            "app-tool-cancel"
        });
        let script = format!(
            "document.getElementById('host').contentWindow.postMessage({},'*');",
            payload
        );
        match session
            .window
            .update(cx, |view, _, cx| -> anyhow::Result<()> {
                view.view
                    .as_ref()
                    .ok_or_else(|| anyhow::anyhow!("MCP app unavailable"))?
                    .read(cx)
                    .raw()
                    .evaluate_script(&script)?;
                Ok(())
            })
            .and_then(|result| result)
        {
            Ok(()) => {}
            Err(error) => self.error = Some(error.to_string()),
        }
    }
}
