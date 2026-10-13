use super::scm_settings::string;
use super::*;
use anyhow::Context as _;

fn settings_with_host(settings: &Value, host: Value) -> anyhow::Result<Value> {
    let mut next = settings.clone();
    let hosts = next
        .get_mut("hosts")
        .and_then(Value::as_array_mut)
        .context("Invalid device host settings")?;
    if let Some(index) = hosts.iter().position(|saved| saved["id"] == host["id"]) {
        hosts[index] = host;
    } else {
        anyhow::ensure!(hosts.len() < 20, "Use at most 20 remote device hosts");
        hosts.push(host);
    }
    Ok(next)
}
impl Workbench {
    pub(super) fn device_host_settings(
        &mut self,
        settings: Value,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let enabled = settings
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let busy = self.pending.iter().any(|key| {
            key.starts_with("device-host-settings-save") || key.starts_with("device-host-test:")
        });
        let editing = self.responses.contains_key("device-host-editor");
        let mut root=div().flex().flex_col().gap_3().child(Self::header("Device Hub","Discover local devices and use other paired computers over SSH. SSH hostnames, users and key paths belong to this runtime computer."));
        let toggle = settings.clone();
        root = root.child(
            Button::new("enable-device-hub")
                .label(if enabled {
                    "Disable Device Hub"
                } else {
                    "Enable Device Hub"
                })
                .disabled(!self.online || busy || editing)
                .on_click(cx.listener(move |this, _, _, cx| {
                    let mut value = toggle.clone();
                    value["enabled"] = json!(!enabled);
                    this.request("device-host-settings-save", "/api/device-hosts", value);
                    cx.notify();
                })),
        );
        let hosts = settings
            .get("hosts")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        for host in &hosts {
            let id = string(host, "id").to_owned();
            let edit_host = host.clone();
            let test_host = host.clone();
            let remove_settings = settings.clone();
            let remove_id = id.clone();
            let generation = self.generation;
            root=root.child(div().flex().flex_col().gap_2().p_3().border_1().border_color(cx.theme().border).rounded_md().child(format!("{} · {}@{}:{} · {}",string(host,"name"),string(host,"sshUser"),string(host,"sshHost"),host["sshPort"],if host["agentAccess"]==true{"Agent access allowed"}else{"Agent access off"}))
                .child(Button::new(SharedString::from(format!("host-edit:{id}"))).label("Edit host").disabled(busy||editing).on_click(cx.listener(move|this,_,_,cx|{this.responses.insert("device-host-editor".into(),edit_host.clone());cx.notify();})))
                .child(Button::new(SharedString::from(format!("host-test:{id}"))).label("Test connection").disabled(!self.online||busy||editing).on_click(cx.listener(move|this,_,_,cx|{this.request(format!("device-host-test:{}",test_host["id"].as_str().unwrap_or_default()),"/api/device-hosts/test",test_host.clone());cx.notify();})))
                .child(Button::new(SharedString::from(format!("host-remove:{id}"))).ghost().label("Remove host…").disabled(!self.online||busy||editing).on_click(cx.listener(move|_,_,window,cx|{
                    let id=remove_id.clone();let mut settings=remove_settings.clone();if let Some(hosts)=settings["hosts"].as_array_mut(){hosts.retain(|host|host["id"]!=id);}
                    if settings["defaultHostId"]==id{settings.as_object_mut().unwrap().remove("defaultHostId");}
                    let prompt=window.prompt(PromptLevel::Warning,"Remove device host?",Some("Devices keep running. This runtime will no longer use that remote host."),&["Keep host","Remove"],cx);
                    cx.spawn(async move|this,cx|{if prompt.await==Ok(1){let _=this.update(cx,|this,cx|{if this.generation==generation{this.request("device-host-settings-save","/api/device-hosts",settings);cx.notify();}});}}).detach();
                }))));
        }
        let default = string(&settings, "defaultHostId").to_owned();
        let mut choices = div()
            .flex()
            .flex_wrap()
            .gap_2()
            .child("Preferred device computer");
        for (id, label) in std::iter::once((String::new(), "This computer".to_owned())).chain(
            hosts.iter().map(|host| {
                (
                    string(host, "id").to_owned(),
                    string(host, "name").to_owned(),
                )
            }),
        ) {
            let mut value = settings.clone();
            if id.is_empty() {
                value.as_object_mut().unwrap().remove("defaultHostId");
            } else {
                value["defaultHostId"] = json!(id);
            }
            choices = choices.child(
                Button::new(SharedString::from(format!("host-default:{id}")))
                    .label(label)
                    .selected(default == id)
                    .disabled(!self.online || busy || editing)
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.request(
                            "device-host-settings-save",
                            "/api/device-hosts",
                            value.clone(),
                        );
                        cx.notify();
                    })),
            );
        }
        root=root.child(choices).child(Button::new("add-device-host").label("Add remote device host").disabled(!enabled||busy||editing||hosts.len()>=20).on_click(cx.listener(|this,_,_,cx|{
            this.responses.insert("device-host-editor".into(),json!({"id":uuid::Uuid::new_v4().to_string(),"name":"","sshHost":"","sshUser":"","sshPort":22,"runtimeAddress":"","agentAccess":false,"hasToken":false}));cx.notify();
        })));
        if let Some(before) = self.responses.get("device-host-editor").cloned() {
            let original_settings = self
                .responses
                .entry("device-host-editor-settings".into())
                .or_insert_with(|| settings.clone())
                .clone();
            if self.responses.get("device-host-editor-closed") == Some(&json!(true)) {
                root = root
                    .child(
                        Button::new("resume-device-host-editor")
                            .label("Resume host draft")
                            .on_click(cx.listener(|this, _, _, cx| {
                                this.responses.remove("device-host-editor-closed");
                                cx.notify();
                            })),
                    )
                    .child(self.discard_device_host_draft(string(&before, "id"), cx));
            } else {
                root = root.child(self.device_host_editor(&original_settings, before, window, cx));
            }
        }
        for (key, result) in &self.responses {
            if key.starts_with("device-host-test:")
                && let Some(checks) = result.get("checks").and_then(Value::as_array)
            {
                for check in checks {
                    root = root.child(format!(
                        "{} · {}: {}",
                        if check["ok"] == true {
                            "Ready"
                        } else {
                            "Check setup"
                        },
                        string(check, "name"),
                        string(check, "message")
                    ));
                }
            }
        }
        root.into_any_element()
    }
    fn device_host_editor(
        &mut self,
        settings: &Value,
        before: Value,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let id = string(&before, "id").to_owned();
        let prefix = format!("device-host-form:{id}");
        let mut root=div().flex().flex_col().gap_3().p_4().border_1().border_color(cx.theme().border).child(Self::header("Remote device host","Select a paired destination. Its device token is stored privately by this runtime."));
        let candidates = self
            .registry
            .profiles
            .iter()
            .filter(|p| p.address != self.address)
            .cloned()
            .collect::<Vec<_>>();
        let paired_key = format!("{prefix}:paired");
        self.input(&paired_key, "", "", window, cx);
        root = root.child("Paired destination");
        if candidates.is_empty() {
            root = root.child(
                "Pair another computer first, or keep an existing host’s connection unchanged.",
            );
        }
        for profile in candidates {
            let key = paired_key.clone();
            let selected = self.value(&key, cx) == profile.id;
            let form_prefix = prefix.clone();
            root = root.child(
                Button::new(SharedString::from(format!(
                    "{prefix}:choose:{}",
                    profile.id
                )))
                .label(profile.name.clone())
                .selected(selected)
                .on_click(cx.listener(move |this, _, window, cx| {
                    if let Some(input) = this.inputs.get(&key) {
                        input.update(cx, |input, cx| {
                            input.set_value(profile.id.clone(), window, cx)
                        });
                    }
                    for (field, value) in [
                        ("runtimeAddress", profile.address.clone()),
                        (
                            "sshHost",
                            url::Url::parse(&profile.address)
                                .ok()
                                .and_then(|url| url.host_str().map(str::to_owned))
                                .unwrap_or_default(),
                        ),
                    ] {
                        if let Some(input) = this.inputs.get(&format!("{form_prefix}:{field}")) {
                            input.update(cx, |input, cx| input.set_value(value, window, cx));
                        }
                    }
                    cx.notify();
                })),
            );
        }
        for (field, label) in [
            ("name", "Name"),
            ("sshHost", "SSH host or alias"),
            ("sshUser", "SSH user"),
            ("identityFile", "SSH key path (optional)"),
            ("runtimeAddress", "Destination runtime address"),
        ] {
            root = root.child(self.field(
                &format!("{prefix}:{field}"),
                label,
                string(&before, field),
                label,
                window,
                cx,
            ));
        }
        root = root
            .child(self.field(
                &format!("{prefix}:sshPort"),
                "SSH port",
                &before["sshPort"].as_u64().unwrap_or(22).to_string(),
                "22",
                window,
                cx,
            ))
            .child(self.field(
                &format!("{prefix}:agentAccess"),
                "Allow agents to use this host",
                if before["agentAccess"] == true {
                    "true"
                } else {
                    "false"
                },
                "false",
                window,
                cx,
            ))
            .child(self.work_field_choices(
                &format!("{prefix}:agentAccess"),
                &["false".into(), "true".into()],
                cx,
            ));
        for (label, save) in [("Test host settings", false), ("Save host", true)] {
            let form_prefix = prefix.clone();
            let base = before.clone();
            let saved = settings.clone();
            let key = format!("device-host-test:{id}");
            root = root.child(
                Button::new(label)
                    .label(label)
                    .disabled(
                        !self.online
                            || self.pending.contains("device-host-settings-save")
                            || self.pending.contains(&key),
                    )
                    .on_click(cx.listener(move |this, _, _, cx| {
                        let candidate = this.device_host_candidate(&form_prefix, &base, cx);
                        match candidate {
                            Ok(host) => {
                                if save {
                                    match settings_with_host(&saved, host) {
                                        Ok(input) => this.config_request(
                                            "device-host-settings-save".into(),
                                            &form_prefix,
                                            "/api/device-hosts",
                                            input,
                                            cx,
                                        ),
                                        Err(error) => this.error = Some(error.to_string()),
                                    }
                                } else {
                                    this.request(key.clone(), "/api/device-hosts/test", host);
                                }
                            }
                            Err(error) => this.error = Some(error.to_string()),
                        };
                        cx.notify();
                    })),
            );
        }
        root.child(
            Button::new("close-device-host-form")
                .ghost()
                .label("Close (keep draft)")
                .on_click(cx.listener(|this, _, _, cx| {
                    this.responses
                        .insert("device-host-editor-closed".into(), json!(true));
                    cx.notify();
                })),
        )
        .child(self.discard_device_host_draft(&id, cx))
        .into_any_element()
    }
    fn discard_device_host_draft(&self, id: &str, cx: &mut Context<Self>) -> Button {
        let id = id.to_owned();
        Button::new("discard-device-host-draft")
            .ghost()
            .label("Discard host draft…")
            .disabled(self.pending.contains("device-host-settings-save"))
            .on_click(cx.listener(move |this, _, window, cx| {
                let generation = this.generation;
                let id = id.clone();
                let prompt = window.prompt(
                    PromptLevel::Warning,
                    "Discard host draft?",
                    Some("Discard the unsaved fields for this remote device host."),
                    &["Keep draft", "Discard"],
                    cx,
                );
                cx.spawn(async move |this, cx| {
                    if prompt.await == Ok(1) {
                        let _ = this.update(cx, |this, cx| {
                            if this.generation != generation
                                || this
                                    .responses
                                    .get("device-host-editor")
                                    .and_then(|value| value.get("id"))
                                    .and_then(Value::as_str)
                                    != Some(&id)
                                || this.pending.contains("device-host-settings-save")
                            {
                                return;
                            }
                            for key in [
                                "device-host-editor",
                                "device-host-editor-settings",
                                "device-host-editor-closed",
                            ] {
                                this.responses.remove(key);
                            }
                            let prefix = format!("device-host-form:{id}:");
                            this.inputs.retain(|key, _| !key.starts_with(&prefix));
                            this.textareas.retain(|key, _| !key.starts_with(&prefix));
                            cx.notify();
                        });
                    }
                })
                .detach();
            }))
    }
    fn device_host_candidate(
        &self,
        prefix: &str,
        before: &Value,
        cx: &App,
    ) -> anyhow::Result<Value> {
        let mut value = before.clone();
        value
            .as_object_mut()
            .context("Invalid host configuration")?
            .remove("hasToken");
        for field in ["name", "sshHost", "sshUser", "runtimeAddress"] {
            let text = self.value(&format!("{prefix}:{field}"), cx);
            anyhow::ensure!(!text.trim().is_empty(), "Enter {field}");
            value[field] = json!(text.trim());
        }
        let identity = self.value(&format!("{prefix}:identityFile"), cx);
        if identity.trim().is_empty() {
            value.as_object_mut().unwrap().remove("identityFile");
        } else {
            value["identityFile"] = json!(identity.trim());
        }
        let port = self
            .value(&format!("{prefix}:sshPort"), cx)
            .parse::<u16>()
            .context("SSH port must be between 1 and 65535")?;
        anyhow::ensure!(port > 0, "SSH port must be between 1 and 65535");
        value["sshPort"] = json!(port);
        let access = self.value(&format!("{prefix}:agentAccess"), cx);
        anyhow::ensure!(
            matches!(access.as_str(), "true" | "false"),
            "Choose true or false for agent access"
        );
        value["agentAccess"] = json!(access == "true");
        let paired = self.value(&format!("{prefix}:paired"), cx);
        if let Some(profile) = self
            .registry
            .profiles
            .iter()
            .find(|profile| profile.id == paired && profile.address != self.address)
        {
            value["token"] = json!(self.storage.connection(profile)?.token);
        } else {
            anyhow::ensure!(
                before["hasToken"] == true
                    && ["sshHost", "sshUser", "sshPort", "runtimeAddress"]
                        .into_iter()
                        .all(|field| before[field] == value[field]),
                "Choose a paired destination before changing the connection"
            );
        }
        crate::connection::normalize_address(string(&value, "runtimeAddress"))?;
        Ok(value)
    }
    pub(super) fn receive_device_host_save(&mut self, key: &str, value: &Value, cx: &App) {
        if key != "device-host-settings-save" {
            return;
        }
        self.responses
            .insert("device-host-settings".into(), value.clone());
        if let Some(before) = self.responses.get("device-host-editor").cloned() {
            let id = string(&before, "id");
            let prefix = format!("device-host-form:{id}");
            let fields = self.responses.remove(&format!("scm-form-receipt:{key}"));
            if let Some(saved) = value["hosts"]
                .as_array()
                .and_then(|hosts| hosts.iter().find(|host| host["id"] == id))
            {
                if fields == Some(self.form_fields(&prefix, cx)) {
                    self.responses.remove("device-host-editor");
                    self.responses.remove("device-host-editor-settings");
                    self.responses.remove("device-host-editor-closed");
                    self.inputs
                        .retain(|key, _| !key.starts_with(&format!("{prefix}:")));
                } else {
                    self.responses
                        .insert("device-host-editor-settings".into(), value.clone());
                    self.responses
                        .insert("device-host-editor".into(), saved.clone());
                }
            }
        }
        self.notice = Some("Device Hub settings saved".into());
    }
}
