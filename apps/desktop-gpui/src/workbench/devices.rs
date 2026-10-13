use super::*;
use serde::Deserialize;

pub(super) struct NativeDevice {
    pub id: String,
    pub width: u32,
    pub height: u32,
    pub image: Option<std::sync::Arc<Image>>,
    bounds: Option<Bounds<Pixels>>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeviceList {
    host: String,
    devices: Vec<DeviceInfo>,
    diagnostics: Vec<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DeviceInfo {
    id: String,
    name: String,
    host_id: Option<String>,
    platform: String,
    kind: Option<String>,
    state: String,
    live_supported: Option<bool>,
}
impl Workbench {
    pub(super) fn open_device(&mut self, result: &Value) -> anyhow::Result<()> {
        let id = result
            .get("id")
            .and_then(Value::as_str)
            .context("The runtime returned no device session")?
            .to_owned();
        let ticket = result
            .get("ticket")
            .and_then(Value::as_str)
            .context("The runtime returned no device ticket")?
            .to_owned();
        self.device_preview = Some(NativeDevice {
            id: id.clone(),
            width: 390,
            height: 844,
            image: None,
            bounds: None,
        });
        self.command(Command::DeviceOpen {
            generation: self.generation,
            id,
            ticket,
        });
        Ok(())
    }
    fn device_pointer(&mut self, position: Point<Pixels>, phase: &str) {
        if let Some(preview) = &self.device_preview
            && let Some(bounds) = preview.bounds
        {
            let x = (f32::from(position.x - bounds.origin.x) / f32::from(bounds.size.width)
                * preview.width as f32)
                .clamp(0., preview.width as f32);
            let y = (f32::from(position.y - bounds.origin.y) / f32::from(bounds.size.height)
                * preview.height as f32)
                .clamp(0., preview.height as f32);
            self.command(Command::DeviceInput{generation:self.generation,input:json!({"type":"pointer","pointerType":"touch","phase":phase,"x":x,"y":y,"button":"left"})});
        }
    }
    pub(super) fn devices_page(
        &mut self,
        task: &Task,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let key = format!("preview-devices:{}", task.id);
        let task_id = task.id.clone();
        let mut root=div().id("devices-pane").flex().flex_col().flex_1().overflow_y_scroll().p_4().gap_3()
            .child(Self::header("Device previews","Screens and controls render natively. Devices run on the runtime computer or its configured device hosts."))
            .child(Button::new("refresh-preview-devices").label("Refresh devices").disabled(self.pending.contains(&key)).on_click(cx.listener(move|this,_,_,cx|{
                this.request(format!("preview-devices:{task_id}"),"/api/previews/devices",json!({"taskId":task_id}));cx.notify();
            })));
        let list: DeviceList = match self.responses.get(&key) {
            Some(value) => match serde_json::from_value(value.clone()) {
                Ok(list) => list,
                Err(error) => {
                    return root
                        .child(format!("Invalid device list: {error}"))
                        .into_any_element();
                }
            },
            None => {
                return root
                    .child("Enable Device Hub under Computers, then refresh this list.")
                    .into_any_element();
            }
        };
        root = root.child(format!("Host: {}", list.host));
        for diagnostic in list.diagnostics {
            root = root.child(diagnostic);
        }
        for device in list.devices {
            let mut row = div()
                .flex()
                .flex_col()
                .gap_2()
                .p_3()
                .border_1()
                .border_color(cx.theme().border)
                .rounded_md()
                .child(format!(
                    "{} · {} · {}",
                    device.name, device.platform, device.state
                ));
            let mut actions = div().flex().flex_wrap().gap_2();
            for (action, label) in [
                ("boot", "Boot"),
                ("shutdown", "Shut down"),
                ("portrait", "Portrait"),
                ("landscape", "Landscape"),
                ("light", "Light appearance"),
                ("dark", "Dark appearance"),
                ("screenshot", "Screenshot"),
                ("apps", "Installed apps"),
            ] {
                if device.kind.as_deref() == Some("physical")
                    && matches!(action, "boot" | "shutdown")
                {
                    continue;
                }
                let task_id = task.id.clone();
                let id = device.id.clone();
                let host = device.host_id.clone();
                actions = actions.child(
                    Button::new(SharedString::from(format!("{action}-{id}")))
                        .label(label)
                        .disabled(!self.online)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            let mut input = json!({"taskId":task_id,"id":id,"action":action});
                            if let Some(host) = &host {
                                input["hostId"] = json!(host);
                            }
                            this.request(
                                format!("device-action:{task_id}:{id}:{action}"),
                                "/api/previews/action",
                                input,
                            );
                            cx.notify();
                        })),
                );
            }
            row = row.child(self.device_app_controls(task, &device, window, cx));
            let task_id = task.id.clone();
            let id = device.id;
            let host = device.host_id;
            actions = actions.child(
                Button::new(SharedString::from(format!("view-{id}")))
                    .primary()
                    .label("Live preview")
                    .disabled(!self.online || device.live_supported == Some(false))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        let mut input = json!({"taskId":task_id,"id":id});
                        if let Some(host) = &host {
                            input["hostId"] = json!(host);
                        }
                        this.request(
                            format!("device-open:{task_id}:{id}"),
                            "/api/previews/simulator/open",
                            input,
                        );
                        cx.notify();
                    })),
            );
            row = row.child(actions);
            root = root.child(row);
        }
        root = root.child(self.device_forward_controls(task, window, cx));
        if let Some(preview) = &self.device_preview {
            let mut controls = div().flex().gap_2().child(
                Button::new("close-native-device")
                    .ghost()
                    .label("Close preview")
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.command(Command::DeviceClose);
                        this.device_preview = None;
                        cx.notify();
                    })),
            );
            controls = controls.child(Button::new("device-back").label("Back / Home").on_click(
                cx.listener(|this, _, _, cx| {
                    this.command(Command::DeviceInput {
                        generation: this.generation,
                        input: json!({"type":"back"}),
                    });
                    cx.notify();
                }),
            ));
            root = root.child(controls);
            if let Some(image) = preview.image.clone() {
                let height = 400.;
                let width = height * preview.width as f32 / preview.height as f32;
                let entity = cx.entity();
                root = root.child(
                    div()
                        .relative()
                        .w(px(width))
                        .h(px(height))
                        .flex_shrink_0()
                        .child(img(image).size_full())
                        .on_mouse_down(
                            MouseButton::Left,
                            cx.listener(|this, event: &MouseDownEvent, _, _| {
                                this.device_pointer(event.position, "down")
                            }),
                        )
                        .on_mouse_up(
                            MouseButton::Left,
                            cx.listener(|this, event: &MouseUpEvent, _, _| {
                                this.device_pointer(event.position, "up")
                            }),
                        )
                        .on_mouse_move(cx.listener(|this, event: &MouseMoveEvent, _, _| {
                            if event.dragging() {
                                this.device_pointer(event.position, "move");
                            }
                        }))
                        .child(
                            canvas(
                                move |bounds, _, cx| {
                                    entity.update(cx, |this, _| {
                                        if let Some(preview) = &mut this.device_preview {
                                            preview.bounds = Some(bounds);
                                        }
                                    });
                                },
                                |_, _, _, _| {},
                            )
                            .absolute()
                            .top_0()
                            .left_0()
                            .size_full(),
                        ),
                );
            } else {
                root = root.child("Waiting for a device frame…");
            }
            root = root
                .child(self.field(
                    "native-device-text",
                    "Send text",
                    "",
                    "Type into the focused device field",
                    window,
                    cx,
                ))
                .child(
                    Button::new("send-device-text")
                        .label("Send text")
                        .on_click(cx.listener(|this, _, _, cx| {
                            let text = this.value("native-device-text", cx);
                            if !text.is_empty() {
                                this.command(Command::DeviceInput {
                                    generation: this.generation,
                                    input: json!({"type":"text","text":text}),
                                });
                            }
                            cx.notify();
                        })),
                );
        }
        root.into_any_element()
    }
}
use anyhow::Context as _;

impl Workbench {
    fn device_app_controls(
        &mut self,
        task: &Task,
        device: &DeviceInfo,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let prefix = format!("device-app:{}:{}", task.id, device.id);
        let mut root = div().flex().flex_col().gap_2();
        for (field, label) in [
            ("url", "Open URL on device"),
            (
                "artifactPath",
                "App artifact path on runtime (.apk or .app)",
            ),
        ] {
            root =
                root.child(self.field(&format!("{prefix}:{field}"), label, "", label, window, cx));
        }
        for (label, action) in [("Open URL", "open"), ("Install app", "install")] {
            let field = if action == "install" {
                "artifactPath"
            } else {
                "url"
            };
            let input_key = format!("{prefix}:{field}");
            let id = device.id.clone();
            let host = device.host_id.clone();
            let task_id = task.id.clone();
            let key = format!("device-action:{task_id}:{id}:{action}");
            root = root.child(
                Button::new(SharedString::from(format!("{prefix}:{action}")))
                    .label(label)
                    .disabled(!self.online || self.pending.contains(&key))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        let text = this.value(&input_key, cx);
                        if text.trim().is_empty() {
                            this.error = Some(format!("Enter {field}"));
                        } else {
                            let mut input = json!({"taskId":task_id,"id":id});
                            if let Some(host) = &host {
                                input["hostId"] = json!(host);
                            }
                            input[field] = json!(text.trim());
                            if action == "install" {
                                this.request(key.clone(), "/api/device-hosts/install", input);
                            } else {
                                input["action"] = json!(action);
                                this.request(key.clone(), "/api/previews/action", input);
                            }
                        }
                        cx.notify();
                    })),
            );
        }
        if let Some(result) = self
            .responses
            .get(&format!("device-action:{}:{}:apps", task.id, device.id))
            && let Some(apps) = result.get("apps").and_then(Value::as_array).cloned()
        {
            for app in apps {
                let name = app.get("name").and_then(Value::as_str).unwrap_or_default();
                let bundle = app
                    .get("bundleId")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned();
                let mut row = div().flex().flex_wrap().gap_2().child(name.to_owned());
                for (action, label) in [("launch", "Launch"), ("relaunch", "Relaunch")] {
                    let mut input =
                        json!({"taskId":task.id,"id":device.id,"action":action,"bundleId":bundle});
                    if let Some(host) = &device.host_id {
                        input["hostId"] = json!(host);
                    }
                    let key = format!("device-action:{}:{}:{action}", task.id, device.id);
                    row = row.child(
                        Button::new(SharedString::from(format!("{prefix}:{action}:{bundle}")))
                            .label(label)
                            .disabled(!self.online || self.pending.contains(&key))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.request(key.clone(), "/api/previews/action", input.clone());
                                cx.notify();
                            })),
                    );
                }
                root = root.child(row);
            }
        }
        if let Some(result) = self.responses.get(&format!(
            "device-action:{}:{}:screenshot",
            task.id, device.id
        )) && let Some(encoded) = result.get("image").and_then(Value::as_str)
        {
            use base64::Engine;
            if let Some(data) = encoded
                .strip_prefix("data:image/png;base64,")
                .and_then(|data| base64::engine::general_purpose::STANDARD.decode(data).ok())
            {
                root = root.child(
                    img(std::sync::Arc::new(Image::from_bytes(
                        ImageFormat::Png,
                        data,
                    )))
                    .max_h(px(400.))
                    .max_w(px(400.)),
                );
            } else {
                root = root.child("The runtime returned an invalid screenshot");
            }
        }
        root.into_any_element()
    }
    fn device_forward_controls(
        &mut self,
        task: &Task,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let prefix = format!("device-forwards:{}", task.id);
        let key = prefix.clone();
        let task_id = task.id.clone();
        let mut root=div().flex().flex_col().gap_3().child(Self::header("Development port forwarding","Forward a port from this runtime to a configured SSH device host. Each forward expires automatically."))
            .child(Button::new("read-device-forwards").label("Refresh forwarding").disabled(!self.online||self.pending.contains(&key)).on_click(cx.listener(move|this,_,_,cx|{this.request(key.clone(),"/api/device-hosts/forwards",json!({"taskId":task_id}));cx.notify();})));
        for (field, label, default) in [
            ("localPort", "Local runtime port", "8081"),
            ("remotePort", "Destination port", "8081"),
            ("durationSeconds", "Duration in seconds (1–3600)", "1800"),
            ("exposeToNetwork", "Expose to destination network", "false"),
        ] {
            root = root.child(self.field(
                &format!("{prefix}:{field}"),
                label,
                default,
                label,
                window,
                cx,
            ));
        }
        root = root.child(self.work_field_choices(
            &format!("{prefix}:exposeToNetwork"),
            &["false".into(), "true".into()],
            cx,
        ));
        let hosts = self
            .responses
            .get("device-host-settings")
            .and_then(|v| v.get("hosts"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        if hosts.is_empty() {
            root =
                root.child("Configure a remote device host under Computers to create a forward.");
        }
        for host in hosts {
            let host_id = host
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned();
            let name = host
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned();
            let form_prefix = prefix.clone();
            let task_id = task.id.clone();
            let key = format!("device-forward:{task_id}:{host_id}");
            root=root.child(Button::new(SharedString::from(format!("{prefix}:start:{host_id}"))).label(format!("Forward to {name}")).disabled(!self.online||self.pending.contains(&key)).on_click(cx.listener(move|this,_,_,cx|{
                let input=(||->anyhow::Result<Value>{
                    let port=|field|->anyhow::Result<u16>{let value=this.value(&format!("{form_prefix}:{field}"),cx).parse::<u16>().context("Use a port between 1 and 65535")?;anyhow::ensure!(value>0,"Use a port between 1 and 65535");Ok(value)};
                    let duration=this.value(&format!("{form_prefix}:durationSeconds"),cx).parse::<u16>().context("Enter a duration between 1 and 3600 seconds")?;anyhow::ensure!((1..=3600).contains(&duration),"Use a duration between 1 and 3600 seconds");
                    let expose=this.value(&format!("{form_prefix}:exposeToNetwork"),cx);anyhow::ensure!(matches!(expose.as_str(),"false"|"true"),"Choose whether to expose the port");
                    Ok(json!({"taskId":task_id,"hostId":host_id,"localPort":port("localPort")?,"remotePort":port("remotePort")?,"durationSeconds":duration,"exposeToNetwork":expose=="true"}))
                })();match input{Ok(input)=>this.request(key.clone(),"/api/device-hosts/forward",input),Err(error)=>this.error=Some(error.to_string())};cx.notify();
            })));
        }
        if let Some(forwards) = self
            .responses
            .get(&prefix)
            .and_then(|v| v.get("forwards"))
            .and_then(Value::as_array)
            .cloned()
        {
            for forward in forwards {
                let id = forward
                    .get("id")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_owned();
                let task_id = task.id.clone();
                let key = format!("device-forward-stop:{task_id}:{id}");
                root = root.child(
                    div()
                        .flex()
                        .flex_wrap()
                        .gap_2()
                        .child(format!(
                            "{} · expires {}",
                            forward
                                .get("url")
                                .and_then(Value::as_str)
                                .unwrap_or_default(),
                            forward
                                .get("expiresAt")
                                .and_then(Value::as_str)
                                .unwrap_or_default()
                        ))
                        .child(
                            Button::new(SharedString::from(key.clone()))
                                .label("Stop forward")
                                .disabled(!self.online || self.pending.contains(&key))
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    this.request(
                                        key.clone(),
                                        "/api/device-hosts/forward/stop",
                                        json!({"taskId":task_id,"id":id}),
                                    );
                                    cx.notify();
                                })),
                        ),
                );
            }
        }
        root.into_any_element()
    }
    pub(super) fn receive_device_action(&mut self, key: &str) {
        let task = key
            .strip_prefix("device-action:")
            .and_then(|rest| rest.split_once(':'))
            .map(|(task, _)| task);
        if let Some(task) = task {
            self.request(
                format!("preview-devices:{task}"),
                "/api/previews/devices",
                json!({"taskId":task}),
            );
        }
        let forward = key
            .strip_prefix("device-forward:")
            .or_else(|| key.strip_prefix("device-forward-stop:"))
            .and_then(|rest| rest.split_once(':'))
            .map(|(task, _)| task);
        if let Some(task) = forward {
            self.request(
                format!("device-forwards:{task}"),
                "/api/device-hosts/forwards",
                json!({"taskId":task}),
            );
        }
    }
}
