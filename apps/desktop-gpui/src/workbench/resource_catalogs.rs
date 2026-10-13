use super::scm_settings::string;
use super::*;

#[derive(Default)]
pub(super) struct CatalogState {
    query: String,
    entries: Vec<Value>,
    cursor: Option<String>,
    active: Option<(String, bool)>,
}
impl CatalogState {
    fn begin(&mut self, key: String, query: String, append: bool) {
        if !append {
            self.entries.clear();
            self.cursor = None;
        }
        self.query = query;
        self.active = Some((key, append));
    }
    fn finish(&mut self, key: &str, page: &Value) -> bool {
        let Some((active, append)) = &self.active else {
            return false;
        };
        if active != key {
            return false;
        }
        let Some(entries) = page.get("entries").and_then(Value::as_array) else {
            return false;
        };
        if !append {
            self.entries.clear();
        }
        for entry in entries {
            let id = entry.get("id").or_else(|| entry.get("name"));
            if let Some(index) = self
                .entries
                .iter()
                .position(|existing| existing.get("id").or_else(|| existing.get("name")) == id)
            {
                self.entries[index] = entry.clone();
            } else {
                self.entries.push(entry.clone());
            }
        }
        self.cursor = page
            .get("cursor")
            .and_then(Value::as_str)
            .map(str::to_owned);
        self.active = None;
        true
    }
}
impl Workbench {
    fn search_resource_catalog(&mut self, kind: &str, query: String, append: bool) {
        let scope = format!("{}:{kind}", self.resources_key());
        self.catalog_serial += 1;
        let key = format!("resource-catalog:{scope}:{}", self.catalog_serial);
        let state = self.catalogs.entry(scope).or_default();
        let mut input = json!({"query":query});
        if append {
            if let Some(cursor) = &state.cursor {
                input["cursor"] = json!(cursor);
            } else {
                return;
            }
        }
        state.begin(key.clone(), query, append);
        self.request(
            key,
            if kind == "mcp" {
                "/api/agents/catalogs/mcp"
            } else {
                "/api/agents/catalogs/skills"
            },
            input,
        );
    }
    pub(super) fn receive_resource_catalog(&mut self, key: &str, value: &Value) {
        if key.starts_with("resource-catalog:") {
            for state in self.catalogs.values_mut() {
                if state.finish(key, value) {
                    break;
                }
            }
        }
        if let Some(scope) = key.strip_prefix("resource-import:") {
            self.staged_resources
                .insert(scope.into(), ("skills".into(), value.clone()));
            self.notice = Some(
                "Skill imported for review; save it to enable it in the selected scope".into(),
            );
        }
        if let Some(scope) = key.strip_prefix("resources-save:")
            && let Some(sent) = self
                .responses
                .remove(&format!("resource-stage-receipt:{key}"))
            && self
                .staged_resources
                .get(scope)
                .is_some_and(|(kind, item)| json!([kind, item]) == sent)
        {
            self.staged_resources.remove(scope);
        }
    }
    pub(super) fn catalog_is_current(&self, key: &str) -> bool {
        self.catalogs.values().any(|state| {
            state
                .active
                .as_ref()
                .is_some_and(|(active, _)| active == key)
        })
    }
    pub(super) fn fail_resource_catalog(&mut self, key: &str) {
        for state in self.catalogs.values_mut() {
            if state
                .active
                .as_ref()
                .is_some_and(|(active, _)| active == key)
            {
                state.active = None;
            }
        }
    }
    pub(super) fn resource_catalog_panel(
        &mut self,
        before: &Value,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let scope = self.resources_key();
        let import_key = format!("resource-import:{scope}");
        let mut panel = div().flex().flex_col().gap_3().child(Self::header(
            "Resource catalogs & imports",
            "Review imported instructions and server launch settings before enabling them.",
        ));
        panel = panel.child(self.field(
            &format!("{scope}:import-path"),
            "SKILL.md path on the runtime",
            "",
            "/path/to/skill/SKILL.md",
            window,
            cx,
        ));
        let local_scope = scope.clone();
        let local_key = import_key.clone();
        let local_repo = self.selected_repository.clone();
        let project = matches!(self.resource_scope, "project" | "environment-project");
        panel = panel.child(
            Button::new("skill-import-local")
                .label("Import local skill for review")
                .disabled(!self.online || self.pending.contains(&import_key))
                .on_click(cx.listener(move |this, _, _, cx| {
                    let path = this.value(&format!("{local_scope}:import-path"), cx);
                    if path.trim().is_empty() {
                        this.error = Some("Enter the SKILL.md path on the runtime computer".into());
                        cx.notify();
                        return;
                    }
                    let mut input = json!({"path":path});
                    if project {
                        input["repositoryId"] = json!(local_repo);
                    }
                    this.request(local_key.clone(), "/api/agents/skills/import", input);
                    cx.notify();
                })),
        );
        panel = panel.child(self.field(
            &format!("{scope}:catalog-query"),
            "Search catalogs",
            "",
            "At least two characters for skills",
            window,
            cx,
        ));
        for (kind, label) in [
            ("mcp", "Search MCP registry"),
            ("skill", "Search skill catalog"),
        ] {
            let query_field = format!("{scope}:catalog-query");
            let catalog_scope = format!("{scope}:{kind}");
            let busy = self
                .catalogs
                .get(&catalog_scope)
                .is_some_and(|state| state.active.is_some());
            panel = panel.child(
                Button::new(kind)
                    .label(label)
                    .disabled(!self.online || busy)
                    .on_click(cx.listener(move |this, _, _, cx| {
                        let query = this.value(&query_field, cx).trim().to_owned();
                        if kind == "skill" && query.len() < 2 {
                            this.error =
                                Some("Use at least two characters to search skills".into());
                        } else {
                            this.search_resource_catalog(kind, query, false);
                        }
                        cx.notify();
                    })),
            );
            if let Some(state) = self.catalogs.get(&catalog_scope) {
                let entries = state.entries.clone();
                let query = state.query.clone();
                let more = state.cursor.is_some();
                for (index, entry) in entries.into_iter().enumerate() {
                    let mut card = div()
                        .flex()
                        .flex_col()
                        .gap_2()
                        .p_3()
                        .border_1()
                        .border_color(cx.theme().border)
                        .rounded_md()
                        .child(format!(
                            "{} · {}",
                            string(&entry, "name"),
                            string(&entry, if kind == "mcp" { "version" } else { "source" })
                        ));
                    if let Some(description) = entry.get("description").and_then(Value::as_str) {
                        card = card.child(description.to_owned());
                    }
                    if let Some(url) = entry.get("url").and_then(Value::as_str) {
                        let url = url.to_owned();
                        card = card.child(
                            Button::new(SharedString::from(format!("catalog-link:{kind}:{index}")))
                                .ghost()
                                .label("View source")
                                .on_click(move |_, _, cx| {
                                    if url::Url::parse(&url)
                                        .is_ok_and(|url| matches!(url.scheme(), "http" | "https"))
                                    {
                                        cx.open_url(&url);
                                    }
                                }),
                        );
                    }
                    if kind == "skill" {
                        let key = import_key.clone();
                        let source = entry.get("source").cloned().unwrap_or(Value::Null);
                        let skill = entry.get("id").cloned().unwrap_or(Value::Null);
                        let repo = self.selected_repository.clone();
                        card = card.child(
                            Button::new(SharedString::from(format!("catalog-import:{index}")))
                                .label("Download skill for review")
                                .disabled(
                                    !self.online
                                        || self.pending.contains(&import_key)
                                        || entry.get("supported") != Some(&json!(true)),
                                )
                                .on_click(cx.listener(move |this, _, _, cx| {
                                    let mut input = json!({"source":source,"skill":skill});
                                    if project {
                                        input["repositoryId"] = json!(repo);
                                    }
                                    this.request(
                                        key.clone(),
                                        "/api/agents/catalogs/skills/import",
                                        input,
                                    );
                                    cx.notify();
                                })),
                        );
                    } else if let Some(variants) = entry.get("variants").and_then(Value::as_array) {
                        for (variant_index, variant) in variants.iter().enumerate() {
                            let item = variant.get("server").cloned();
                            let stage_scope = scope.clone();
                            card =
                                card.child(
                                    Button::new(SharedString::from(format!(
                                        "catalog-variant:{index}:{variant_index}"
                                    )))
                                    .label(string(variant, "label").to_owned())
                                    .disabled(item.is_none() || self.pending.contains(&import_key))
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        if let Some(item) = &item {
                                            this.staged_resources.insert(
                                                stage_scope.clone(),
                                                ("mcpServers".into(), item.clone()),
                                            );
                                        }
                                        cx.notify();
                                    })),
                                );
                            for note in variant
                                .get("notes")
                                .and_then(Value::as_array)
                                .into_iter()
                                .flatten()
                                .filter_map(Value::as_str)
                            {
                                card = card.child(note.to_owned());
                            }
                        }
                    }
                    panel = panel.child(card);
                }
                if more {
                    panel = panel.child(
                        Button::new(SharedString::from(format!("catalog-more:{kind}")))
                            .label("More catalog results")
                            .disabled(!self.online || busy)
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.search_resource_catalog(kind, query.clone(), true);
                                cx.notify();
                            })),
                    );
                }
            }
        }
        if let Some((kind, item)) = self.staged_resources.get(&scope).cloned() {
            panel = panel.child(Self::header("Review import", string(&item, "name")));
            if kind == "skills" {
                panel = panel.child(
                    TextView::markdown("skill-import-content", string(&item, "content").to_owned())
                        .selectable(true),
                );
                if let Some(path) = item.get("sourcePath").and_then(Value::as_str) {
                    panel = panel.child(format!("Supporting files: {path}"));
                }
                if matches!(self.resource_scope, "global" | "project") {
                    panel=panel.child("Shared scopes keep local imports as instructions only. Use a computer scope to retain local supporting files.");
                }
            } else {
                panel = panel.child(format!(
                    "{} · {} {}",
                    string(&item, "transport"),
                    string(&item, "command"),
                    string(&item, "url")
                ));
                panel=panel.child("The existing MCP editor can configure arguments and environment bindings after saving.");
            }
            let before = before.clone();
            let captured_scope = scope.clone();
            let save_kind = kind.clone();
            let mut imported = item.clone();
            if kind == "skills" && matches!(self.resource_scope, "global" | "project") {
                imported
                    .as_object_mut()
                    .map(|item| item.remove("sourcePath"));
            }
            panel=panel.child(Button::new("import-resource-save").primary().label("Save imported resource").disabled(!self.online||self.pending.contains(&format!("resources-save:{scope}"))).on_click(cx.listener(move|this,_,_,cx|{
                if this.resources_key()!=captured_scope{return;}
                let mut resources=this.resource_value(&before);
                if resources.get(&save_kind).is_none(){resources[&save_kind]=json!([]);}
                let Some(items)=resources[&save_kind].as_array_mut()else{this.error=Some("Invalid resource list".into());cx.notify();return;};
                if items.iter().any(|item|item.get("name")==imported.get("name")){this.error=Some("A resource with this name already exists; edit it or remove it before importing".into());cx.notify();return;}
                items.push(imported.clone());if let Some((kind,item))=this.staged_resources.get(&captured_scope){this.responses.insert(format!("resource-stage-receipt:resources-save:{captured_scope}"),json!([kind,item]));}this.save_resources(before.clone(),resources,cx);cx.notify();
            }))).child(Button::new("import-resource-discard").label("Discard import").on_click(cx.listener(move|this,_,_,cx|{this.staged_resources.remove(&scope);cx.notify();})));
        }
        panel.into_any_element()
    }
}
#[cfg(test)]
mod tests {
    use super::CatalogState;
    use serde_json::json;
    #[test]
    fn catalog_pages_ignore_previous_queries_and_update_duplicate_entries() {
        let mut state = CatalogState::default();
        state.begin("old".into(), "old query".into(), false);
        state.begin("new".into(), "new query".into(), false);
        assert!(!state.finish("old", &json!({"entries":[{"name":"old"}]})));
        assert!(state.finish(
            "new",
            &json!({"entries":[{"name":"one","version":"1"}],"cursor":"next"})
        ));
        state.begin("next".into(), "new query".into(), true);
        assert!(state.finish(
            "next",
            &json!({"entries":[{"name":"one","version":"2"},{"name":"two"}]})
        ));
        assert_eq!(state.entries.len(), 2);
        assert_eq!(state.entries[0]["version"], "2");
        assert!(state.cursor.is_none());
    }
}
