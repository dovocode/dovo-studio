use super::scm_settings::string;
use super::*;
use anyhow::Context as _;
use serde::Deserialize;
use sha2::{Digest, Sha256};

#[derive(Clone, Deserialize)]
pub(super) struct Choice {
    pub(super) id: String,
    name: String,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CatalogModel {
    id: String,
    name: String,
    reasoning: Option<Vec<Choice>>,
    service_tiers: Option<Vec<Choice>>,
}
#[derive(Clone, Deserialize)]
pub(super) struct ModelCatalog {
    pub(super) models: Vec<CatalogModel>,
    reasoning: Vec<Choice>,
    acp: Option<AcpCatalog>,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AcpCatalog {
    modes: Vec<Choice>,
    config_options: Vec<ConfigOption>,
}
#[derive(Clone, Deserialize)]
struct ConfigOption {
    id: String,
    name: String,
    options: Vec<Choice>,
}

fn discovery_key(prefix: &str, agent: &Value) -> String {
    let mut launch = json!({"provider":agent["provider"],"endpoint":agent["endpoint"],"args":agent.get("args").cloned().unwrap_or(json!([])),"env":agent.get("env").cloned().unwrap_or(json!({})),"model":if matches!(agent["provider"].as_str(),Some("acp"|"grok")){agent["model"].clone()}else{json!("")}});
    for field in ["executablePath", "configDirectory"] {
        if let Some(value) = agent.get(field) {
            launch[field] = value.clone();
        }
    }
    if agent["provider"] == "acp" {
        launch["acpConfig"] = agent.get("acpConfig").cloned().unwrap_or(json!({}));
        for field in ["acpInstallationId", "acpMode"] {
            if let Some(value) = agent.get(field) {
                launch[field] = value.clone();
            }
        }
    }
    format!(
        "harness-models:{prefix}:{:x}",
        Sha256::digest(launch.to_string().as_bytes())
    )
}

pub(super) fn freeze_agent(agent: &crate::model::Agent) -> anyhow::Result<Value> {
    let mut value = serde_json::to_value(agent)?;
    if let Some(fields) = value.as_object_mut() {
        for key in ["id", "name", "icon", "globalPreset", "serverOverride"] {
            fields.remove(key);
        }
    }
    Ok(value)
}
fn mapping_text(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_object)
        .map(|items| {
            items
                .iter()
                .filter_map(|(k, v)| v.as_str().map(|v| format!("{k}={v}")))
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default()
}
impl Workbench {
    pub(super) fn harness_fields(
        &mut self,
        prefix: &str,
        before: &Value,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        self.harness_fields_inner(prefix, before, true, window, cx)
    }
    pub(super) fn default_harness_fields(
        &mut self,
        prefix: &str,
        before: &Value,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        self.harness_fields_inner(prefix, before, false, window, cx)
    }
    fn harness_fields_inner(
        &mut self,
        prefix: &str,
        before: &Value,
        permission: bool,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let mut root = div().flex().flex_col().gap_3();
        for (field, label) in [
            ("provider", "Provider"),
            ("model", "Model"),
            ("reasoning", "Reasoning effort"),
            ("serviceTier", "Service tier"),
            ("permission", "Permissions"),
            ("endpoint", "Endpoint or ACP executable"),
            ("executablePath", "Provider executable"),
            ("configDirectory", "Provider configuration directory"),
            ("cyberAccessProgram", "Codex access program"),
            ("acpInstallationId", "ACP installation ID"),
            ("acpMode", "ACP mode"),
        ] {
            if field == "permission" && !permission {
                continue;
            }
            root = root.child(self.field(
                &format!("{prefix}:{field}"),
                label,
                string(before, field),
                label,
                window,
                cx,
            ));
            let choices = match field {
                "provider" => crate::model::Provider::ALL
                    .iter()
                    .map(|p| p.name().to_owned())
                    .collect(),
                "permission" => ["ask", "read-only", "workspace-write", "auto", "full-access"]
                    .into_iter()
                    .map(str::to_owned)
                    .collect(),
                "cyberAccessProgram" => ["", "standard", "daybreakBlue", "daybreakRed"]
                    .into_iter()
                    .map(str::to_owned)
                    .collect(),
                _ => vec![],
            };
            if !choices.is_empty() {
                root =
                    root.child(self.work_field_choices(&format!("{prefix}:{field}"), &choices, cx));
            }
        }
        if self.value(&format!("{prefix}:provider"), cx) == "acp" {
            root = root.child(self.acp_installation_choices(prefix, window, cx));
        }
        let args = before
            .get("args")
            .and_then(Value::as_array)
            .map(|args| {
                args.iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .unwrap_or_default();
        for (field, label, text) in [
            (
                "instructions",
                "Agent instructions",
                string(before, "instructions").to_owned(),
            ),
            ("args", "Arguments (one per line)", args),
            (
                "env",
                "Environment variables (NAME=value)",
                mapping_text(before.get("env")),
            ),
            (
                "acpConfig",
                "ACP configuration (key=value)",
                mapping_text(before.get("acpConfig")),
            ),
        ] {
            root = root.child(self.text_field(
                &format!("{prefix}:{field}"),
                label,
                &text,
                label,
                window,
                cx,
            ));
        }
        let current = self.harness_value(prefix, before, cx).ok();
        let key = current.as_ref().map(|value| discovery_key(prefix, value));
        let form_prefix = prefix.to_owned();
        let base = before.clone();
        root = root.child(
            Button::new(SharedString::from(format!("{prefix}:discover-models")))
                .label("Discover models and provider options")
                .disabled(
                    !self.online || key.as_ref().is_some_and(|key| self.pending.contains(key)),
                )
                .on_click(cx.listener(move |this, _, _, cx| {
                    match this.harness_value(&form_prefix, &base, cx) {
                        Ok(mut value) => {
                            let request_key = discovery_key(&form_prefix, &value);
                            value["refresh"] = json!(true);
                            this.request(request_key, "/api/agents/models", value);
                        }
                        Err(error) => this.error = Some(error.to_string()),
                    };
                    cx.notify();
                })),
        );
        if let Some(response) = key.as_ref().and_then(|key| self.responses.get(key)) {
            match serde_json::from_value::<ModelCatalog>(response.clone()) {
                Ok(catalog) => {
                    let choices = catalog
                        .models
                        .iter()
                        .map(|m| Choice {
                            id: m.id.clone(),
                            name: m.name.clone(),
                        })
                        .collect::<Vec<_>>();
                    root =
                        root.child(self.catalog_choices(&format!("{prefix}:model"), &choices, cx));
                    let model = self.value(&format!("{prefix}:model"), cx);
                    let selected = catalog.models.iter().find(|m| m.id == model);
                    let reasoning = selected
                        .and_then(|m| m.reasoning.as_ref())
                        .unwrap_or(&catalog.reasoning);
                    root = root.child(self.catalog_choices(
                        &format!("{prefix}:reasoning"),
                        reasoning,
                        cx,
                    ));
                    let mut tiers = vec![Choice {
                        id: "default".into(),
                        name: "Standard".into(),
                    }];
                    if let Some(choices) = selected.and_then(|m| m.service_tiers.clone()) {
                        tiers.extend(choices.into_iter().filter(|t| t.id != "default"));
                    }
                    root = root.child(self.catalog_choices(
                        &format!("{prefix}:serviceTier"),
                        &tiers,
                        cx,
                    ));
                    if let Some(acp) = catalog.acp {
                        root = root.child(self.catalog_choices(
                            &format!("{prefix}:acpMode"),
                            &acp.modes,
                            cx,
                        ));
                        for option in acp.config_options {
                            let form = prefix.to_owned();
                            let option_id = option.id.clone();
                            let values = parse_environment(
                                &self.text_value(&format!("{prefix}:acpConfig"), cx),
                                false,
                            )
                            .ok();
                            let mut row = div().flex().flex_wrap().gap_2().child(option.name);
                            for choice in option.options {
                                let selected = values
                                    .as_ref()
                                    .and_then(|v| v.get(&option_id))
                                    .and_then(Value::as_str)
                                    == Some(&choice.id);
                                let id = option_id.clone();
                                let form = form.clone();
                                row = row.child(
                                    Button::new(SharedString::from(format!(
                                        "{form}:config:{id}:{}",
                                        choice.id
                                    )))
                                    .label(choice.name)
                                    .selected(selected)
                                    .on_click(cx.listener(move |this, _, window, cx| {
                                        let key = format!("{form}:acpConfig");
                                        match parse_environment(&this.text_value(&key, cx), false) {
                                            Ok(mut values) => {
                                                values[&id] = json!(choice.id);
                                                if let Some(input) = this.textareas.get(&key) {
                                                    input.update(cx, |state, cx| {
                                                        state.set_value(
                                                            mapping_text(Some(&values)),
                                                            window,
                                                            cx,
                                                        )
                                                    });
                                                }
                                            }
                                            Err(error) => this.error = Some(error.to_string()),
                                        }
                                        cx.notify();
                                    })),
                                );
                            }
                            root = root.child(row);
                        }
                    }
                }
                Err(error) => root = root.child(format!("Invalid model catalog: {error}")),
            }
        }
        root.into_any_element()
    }
    fn catalog_choices(&self, key: &str, choices: &[Choice], cx: &mut Context<Self>) -> AnyElement {
        let current = self.value(key, cx);
        div()
            .flex()
            .flex_wrap()
            .gap_2()
            .children(choices.iter().map(|choice| {
                let key = key.to_owned();
                let id = choice.id.clone();
                Button::new(SharedString::from(format!("{key}:catalog:{id}")))
                    .label(choice.name.clone())
                    .selected(current == id)
                    .on_click(cx.listener(move |this, _, window, cx| {
                        if let Some(input) = this.inputs.get(&key) {
                            input.update(cx, |state, cx| state.set_value(id.clone(), window, cx));
                        }
                        cx.notify();
                    }))
            }))
            .into_any_element()
    }
    pub(super) fn harness_value(
        &self,
        prefix: &str,
        before: &Value,
        cx: &App,
    ) -> anyhow::Result<Value> {
        let mut value = before.clone();
        anyhow::ensure!(value.is_object(), "Invalid agent configuration");
        for field in [
            "provider",
            "model",
            "reasoning",
            "serviceTier",
            "permission",
            "endpoint",
            "executablePath",
            "configDirectory",
            "cyberAccessProgram",
            "acpInstallationId",
            "acpMode",
        ] {
            let key = format!("{prefix}:{field}");
            if !self.inputs.contains_key(&key) {
                continue;
            }
            let text = self.value(&key, cx);
            if text.is_empty() && !matches!(field, "provider" | "model" | "permission" | "endpoint")
            {
                value.as_object_mut().unwrap().remove(field);
            } else {
                value[field] = json!(text);
            }
        }
        for field in ["instructions", "args", "env", "acpConfig"] {
            let key = format!("{prefix}:{field}");
            if !self.textareas.contains_key(&key) {
                continue;
            }
            let text = self.text_value(&key, cx);
            value[field] = match field {
                "args" => json!(text.lines().map(str::to_owned).collect::<Vec<_>>()),
                "env" | "acpConfig" => parse_environment(&text, field == "env")?,
                _ => json!(text),
            };
        }
        let checked: crate::model::Agent = serde_json::from_value({
            let mut agent = value.clone();
            agent["id"] = json!("native-harness");
            agent["name"] = json!("Native harness");
            agent
        })?;
        use crate::model::{Permission, Provider};
        anyhow::ensure!(
            !matches!(
                (checked.provider, checked.permission),
                (
                    Provider::Cursor,
                    Permission::Ask | Permission::WorkspaceWrite
                ) | (
                    Provider::Hermes | Provider::Grok | Provider::Muse,
                    Permission::ReadOnly
                )
            ),
            "This provider does not support the selected permission mode"
        );
        if checked.provider == Provider::Acp {
            anyhow::ensure!(
                value
                    .get("acpInstallationId")
                    .and_then(Value::as_str)
                    .is_some_and(|s| !s.is_empty())
                    || !checked.endpoint.trim().is_empty(),
                "Choose an installed ACP agent or executable"
            );
        }
        Ok(value)
    }
}
fn parse_environment(text: &str, environment: bool) -> anyhow::Result<Value> {
    let mut items = serde_json::Map::new();
    for line in text.lines().filter(|line| !line.trim().is_empty()) {
        let (name, value) = line
            .split_once('=')
            .context("Use key=value, one entry per line")?;
        let name = name.trim();
        anyhow::ensure!(!name.is_empty(), "Configuration key cannot be empty");
        if environment {
            anyhow::ensure!(
                name.bytes().enumerate().all(|(i, b)| b == b'_'
                    || b.is_ascii_alphabetic()
                    || (i > 0 && b.is_ascii_digit()))
                    && !matches!(name, "DOVO_OWNER_TOKEN" | "ELECTRON_RUN_AS_NODE"),
                "Unsupported environment variable: {name}"
            );
        }
        anyhow::ensure!(
            !items.contains_key(name),
            "Duplicate configuration key: {name}"
        );
        items.insert(name.to_owned(), json!(value));
    }
    Ok(Value::Object(items))
}
#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    #[test]
    fn catalog_results_follow_launch_settings_and_provider_dependencies() {
        let agent = json!({"provider":"codex","endpoint":"","model":"first","env":{"SECRET":"private-value"}});
        let initial = discovery_key("form", &agent);
        assert!(!initial.contains("private-value"));
        let mut edited = agent.clone();
        edited["model"] = json!("second");
        edited["instructions"] = json!("Local edits");
        assert_eq!(initial, discovery_key("form", &edited));
        edited["env"]["SECRET"] = json!("other");
        assert_ne!(initial, discovery_key("form", &edited));
        let agent =
            json!({"provider":"acp","endpoint":"","model":"first","acpInstallationId":"agent"});
        let initial = discovery_key("form", &agent);
        let mut edited = agent.clone();
        edited["model"] = json!("second");
        assert_ne!(initial, discovery_key("form", &edited));
        edited = agent.clone();
        edited["acpMode"] = json!("plan");
        assert_ne!(initial, discovery_key("form", &edited));
        edited = agent.clone();
        edited["args"] = json!([]);
        edited["env"] = json!({});
        edited["acpConfig"] = json!({});
        assert_eq!(initial, discovery_key("form", &edited));
    }
    #[test]
    fn environment_preserves_equals_and_rejects_reserved_keys() {
        assert_eq!(
            parse_environment("TOKEN=a=b\nEMPTY=", true).unwrap(),
            json!({"TOKEN":"a=b","EMPTY":""})
        );
        for text in [
            "DOVO_OWNER_TOKEN=x",
            "ELECTRON_RUN_AS_NODE=1",
            "1KEY=x",
            "A=1\nA=2",
        ] {
            assert!(parse_environment(text, true).is_err());
        }
    }
}
