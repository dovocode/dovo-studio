use super::*;
use anyhow::{Result, ensure};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub(crate) struct Profile {
    pub id: String,
    pub name: String,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct Catalog {
    pub profiles: Vec<Profile>,
}
impl Catalog {
    pub(crate) fn validate(&self) -> Result<()> {
        let mut ids = HashSet::new();
        ensure!(
            !self.profiles.is_empty(),
            "Keep at least the default profile"
        );
        for profile in &self.profiles {
            ensure!(
                !profile.id.is_empty()
                    && profile.id.len() <= 100
                    && profile
                        .id
                        .bytes()
                        .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
                    && ids.insert(&profile.id),
                "Invalid or duplicate browser profile ID"
            );
            ensure!(
                !profile.name.trim().is_empty() && profile.name.encode_utf16().count() <= 100,
                "Browser profile names need 1–100 characters"
            );
        }
        ensure!(
            ids.contains(&"default".to_owned()),
            "Keep the default browser profile"
        );
        Ok(())
    }
}
#[derive(Clone)]
pub(crate) struct Session {
    pub id: String,
    pub task: String,
    pub profile: String,
    pub address: String,
    pub closing: bool,
}
impl Session {
    pub(crate) fn input(&self, navigate: bool) -> Value {
        let mut input = json!({"taskId":self.task,"tabId":self.id,"profileId":self.profile});
        if navigate {
            input["url"] = json!(self.address);
        }
        input
    }
    fn open_key(&self) -> String {
        format!("browser:open:{}", self.id)
    }
}
#[derive(Default)]
pub(super) struct BrowserState {
    catalog: Option<Catalog>,
    requested: bool,
    selected: HashMap<String, String>,
    sessions: Vec<Session>,
    remove_profile: Option<String>,
    added_name: Option<String>,
}
impl Workbench {
    fn read_browser_profiles(&mut self, refresh: bool) {
        if self.online
            && (refresh || !self.browser.requested)
            && !self.pending.contains("browser:profiles-save")
        {
            self.browser.requested = true;
            self.request(
                "browser:profiles",
                "/api/previews/browser/profiles/read",
                json!({}),
            );
        }
    }
    fn save_browser_profiles(&mut self, catalog: Catalog) {
        if !self.online
            || self.pending.contains("browser:profiles-save")
            || self.pending.contains("browser:profiles")
        {
            return;
        }
        match catalog.validate() {
            Ok(()) => self.request(
                "browser:profiles-save",
                "/api/previews/browser/profiles/save",
                json!(catalog),
            ),
            Err(error) => self.error = Some(error.to_string()),
        }
    }
    pub(super) fn browser_profiles_editor(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        self.read_browser_profiles(false);
        let busy = !self.online
            || self.pending.contains("browser:profiles-save")
            || self.pending.contains("browser:profiles");
        let mut root = div().flex().flex_col().gap_3()
            .child(Self::header("Browser profiles", "Profiles and website logins stay on the connected computer. Removing a profile keeps its saved website data."))
            .child(Button::new("refresh-browser-profiles").label("Refresh profiles").disabled(busy)
                .on_click(cx.listener(|this, _, _, cx| { this.read_browser_profiles(true); cx.notify(); })));
        let Some(catalog) = self.browser.catalog.clone() else {
            return root
                .child("Connect a computer and load its profiles.")
                .into_any_element();
        };
        for profile in &catalog.profiles {
            let key = format!("browser-profile-name:{}", profile.id);
            let input = self.input(&key, &profile.name, "Profile name", window, cx);
            let changed = self.value(&key, cx).trim() != profile.name;
            let id = profile.id.clone();
            let mut row = div()
                .flex()
                .items_center()
                .gap_2()
                .child(div().flex_1().child(Input::new(&input)))
                .child(
                    Button::new(SharedString::from(format!("rename-browser-{}", profile.id)))
                        .label("Save name")
                        .disabled(busy || !changed)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            if let Some(mut catalog) = this.browser.catalog.clone() {
                                let name = this.value(&key, cx).trim().to_owned();
                                if let Some(profile) =
                                    catalog.profiles.iter_mut().find(|p| p.id == id)
                                {
                                    profile.name = name;
                                }
                                this.save_browser_profiles(catalog);
                            }
                            cx.notify();
                        })),
                );
            if profile.id != "default" {
                let id = profile.id.clone();
                row = row.child(
                    Button::new(SharedString::from(format!("remove-browser-{id}")))
                        .label("Remove")
                        .disabled(busy)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.browser.remove_profile = Some(id.clone());
                            cx.notify();
                        })),
                );
            }
            root = root.child(row);
        }
        if let Some(id) = self.browser.remove_profile.clone() {
            root = root.child(div().flex().flex_col().gap_2().child("Remove this profile from the picker? Existing sessions and saved website data remain.")
                .child(div().flex().gap_2()
                    .child(Button::new("confirm-browser-profile-removal").label("Remove profile").disabled(busy).on_click(cx.listener(move |this, _, _, cx| {
                        if let Some(mut catalog) = this.browser.catalog.clone() {
                            catalog.profiles.retain(|p| p.id != id);
                            this.save_browser_profiles(catalog);
                        }
                        cx.notify();
                    })))
                    .child(Button::new("cancel-browser-profile-removal").label("Keep profile").on_click(cx.listener(|this, _, _, cx| { this.browser.remove_profile = None; cx.notify(); })))));
        }
        let name = self.input("browser-profile-new", "", "Work, Personal…", window, cx);
        root.child(
            div()
                .flex()
                .gap_2()
                .child(div().flex_1().child(Input::new(&name)))
                .child(
                    Button::new("add-browser-profile")
                        .primary()
                        .label("Add profile")
                        .disabled(busy || self.value("browser-profile-new", cx).trim().is_empty())
                        .on_click(cx.listener(|this, _, _, cx| {
                            if let Some(mut catalog) = this.browser.catalog.clone() {
                                let name = this.value("browser-profile-new", cx).trim().to_owned();
                                catalog.profiles.push(Profile {
                                    id: uuid::Uuid::new_v4().to_string(),
                                    name: name.clone(),
                                });
                                this.browser.added_name = Some(name);
                                this.save_browser_profiles(catalog);
                            }
                            cx.notify();
                        })),
                ),
        )
        .into_any_element()
    }
    pub(super) fn browser_page(
        &mut self,
        task: &Task,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        self.read_browser_profiles(false);
        let key = format!("browser-address:{}", task.id);
        let address = self.input(
            &key,
            "http://localhost:3000",
            "Preview URL on the runtime host",
            window,
            cx,
        );
        let mut root = div().id("native-browser-page").flex().flex_col().flex_1().min_h_0().overflow_y_scroll().p_4().gap_3()
            .child(Self::header("Browser preview", "Each session retains its chosen profile on the runtime host. Open several sessions to keep websites separate."))
            .child(Input::new(&address));
        if let Some(catalog) = self.browser.catalog.clone() {
            let selected = self
                .browser
                .selected
                .get(&task.id)
                .cloned()
                .unwrap_or_else(|| "default".into());
            root = root.child(div().flex().flex_wrap().gap_2().children(
                catalog.profiles.into_iter().map(|profile| {
                    let task = task.id.clone();
                    Button::new(SharedString::from(format!(
                        "choose-browser-profile-{}",
                        profile.id
                    )))
                    .label(profile.name)
                    .selected(selected == profile.id)
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.browser
                            .selected
                            .insert(task.clone(), profile.id.clone());
                        cx.notify();
                    }))
                }),
            ));
            let task_id = task.id.clone();
            root = root.child(
                Button::new("open-browser")
                    .primary()
                    .label("New preview session")
                    .disabled(!self.online)
                    .on_click(cx.listener(move |this, _, _, cx| {
                        let profile = this
                            .browser
                            .selected
                            .get(&task_id)
                            .cloned()
                            .unwrap_or_else(|| "default".into());
                        let session = Session {
                            id: uuid::Uuid::new_v4().to_string(),
                            task: task_id.clone(),
                            profile,
                            address: this.value(&key, cx),
                            closing: false,
                        };
                        this.request(
                            session.open_key(),
                            "/api/previews/browser/open",
                            session.input(true),
                        );
                        this.browser.sessions.push(session);
                        cx.notify();
                    })),
            );
        } else {
            root = root.child(
                Button::new("load-browser-profiles")
                    .label("Load profiles")
                    .disabled(!self.online)
                    .on_click(cx.listener(|this, _, _, cx| {
                        this.read_browser_profiles(true);
                        cx.notify();
                    })),
            );
        }
        for session in self
            .browser
            .sessions
            .clone()
            .into_iter()
            .filter(|s| s.task == task.id)
        {
            let profile = self
                .browser
                .catalog
                .as_ref()
                .and_then(|c| c.profiles.iter().find(|p| p.id == session.profile))
                .map(|p| p.name.as_str())
                .unwrap_or(&session.profile);
            let id = session.id.clone();
            root = root.child(
                div()
                    .flex()
                    .flex_col()
                    .gap_2()
                    .p_3()
                    .border_1()
                    .border_color(cx.theme().border)
                    .rounded_md()
                    .child(format!(
                        "{profile} · {}{}",
                        session.address,
                        if session.closing { " · Closing" } else { "" }
                    ))
                    .child(
                        div()
                            .flex()
                            .gap_2()
                            .child(
                                Button::new(SharedString::from(format!("show-browser-{id}")))
                                    .label("Show / reconnect")
                                    .disabled(
                                        !self.online
                                            || session.closing
                                            || self.pending.contains(&session.open_key()),
                                    )
                                    .on_click(cx.listener({
                                        let id = id.clone();
                                        move |this, _, _, cx| {
                                            let _ =
                                                this.browser_windows.get(&id).is_some_and(|h| {
                                                    h.update(cx, |_, window, _| {
                                                        window.activate_window()
                                                    })
                                                    .is_ok()
                                                });
                                            this.browser_action(&id, "reconnect", cx);
                                            cx.notify();
                                        }
                                    })),
                            )
                            .child(
                                Button::new(SharedString::from(format!("close-browser-{id}")))
                                    .label(if session.closing {
                                        "Retry close"
                                    } else {
                                        "Close session"
                                    })
                                    .disabled(
                                        !self.online
                                            || self
                                                .pending
                                                .contains(&format!("browser:close:{id}")),
                                    )
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        this.browser_action(&id, "close", cx);
                                        cx.notify();
                                    })),
                            ),
                    ),
            );
        }
        root.child(
            Button::new("manage-browser-profiles")
                .label("Manage profiles in Settings")
                .on_click(cx.listener(|this, _, _, cx| {
                    this.page = Page::Settings;
                    this.request("preferences", "/api/runtime/preferences/read", json!({}));
                    cx.notify();
                })),
        )
        .into_any_element()
    }
    pub(super) fn browser_action(&mut self, id: &str, action: &str, cx: &mut Context<Self>) {
        let Some(session) = self.browser.sessions.iter_mut().find(|s| s.id == id) else {
            return;
        };
        match action {
            "reconnect" if !session.closing => {
                let session = session.clone();
                self.request(
                    session.open_key(),
                    "/api/previews/browser/open",
                    session.input(false),
                );
            }
            "close" => {
                session.closing = true;
                let session = session.clone();
                if let Some(handle) = self.browser_windows.remove(id) {
                    let _ = handle.update(cx, |view, window, cx| view.close(window, cx));
                }
                // Close after an in-flight open settles, so it cannot recreate the session later.
                if !self.pending.contains(&session.open_key()) {
                    self.request(
                        format!("browser:close:{id}"),
                        "/api/previews/browser/close",
                        session.input(false),
                    );
                }
            }
            _ => {}
        }
    }
    pub(super) fn receive_browser(
        &mut self,
        key: &str,
        result: std::result::Result<Value, String>,
        cx: &mut Context<Self>,
    ) {
        if key == "browser:profiles" || key == "browser:profiles-save" {
            let result = result.map_err(anyhow::Error::msg).and_then(|v| {
                let catalog: Catalog = serde_json::from_value(v)?;
                catalog.validate()?;
                Ok(catalog)
            });
            match result {
                Ok(catalog) => {
                    self.browser
                        .selected
                        .retain(|_, id| catalog.profiles.iter().any(|p| p.id == *id));
                    self.browser.catalog = Some(catalog);
                    if key.ends_with("save") {
                        self.browser.remove_profile = None;
                        if let Some(name) = self.browser.added_name.take()
                            && self.value("browser-profile-new", cx).trim() == name
                        {
                            self.inputs.remove("browser-profile-new");
                        }
                    }
                }
                Err(error) => {
                    self.browser.added_name = None;
                    self.error = Some(error.to_string());
                }
            }
            return;
        }
        if let Some(id) = key.strip_prefix("browser:close:") {
            match result {
                Ok(_) => self.browser.sessions.retain(|s| s.id != id),
                Err(error) => {
                    self.error = Some(format!("Could not close browser session: {error}"))
                }
            }
            return;
        }
        let Some(id) = key.strip_prefix("browser:open:") else {
            return;
        };
        let Some(session) = self.browser.sessions.iter().find(|s| s.id == id).cloned() else {
            return;
        };
        if session.closing {
            self.browser_action(id, "close", cx);
            return;
        }
        let result = result.map_err(anyhow::Error::msg).and_then(|value| {
            ensure!(
                value.get("tabId").and_then(Value::as_str) == Some(&session.id)
                    && value.get("profileId").and_then(Value::as_str) == Some(&session.profile),
                "The browser ticket belongs to a different session or profile"
            );
            let ticket = value
                .get("ticket")
                .and_then(Value::as_str)
                .ok_or_else(|| anyhow::anyhow!("The runtime returned no browser ticket"))?;
            let mut url = url::Url::parse(&self.address)?.join("/ws/browser")?;
            let scheme = if url.scheme() == "https" { "wss" } else { "ws" };
            url.set_scheme(scheme)
                .map_err(|_| anyhow::anyhow!("Invalid browser socket scheme"))?;
            url.query_pairs_mut()
                .append_pair("ticket", ticket)
                .append_pair("frames", "binary-v1");
            let script = format!(
                "window.postMessage({},'*');",
                json!({"channel":"dovo-browser","type":"connect","url":url.as_str()})
            );
            if let Some(handle) = self.browser_windows.get(id)
                && handle
                    .update(cx, |view, _, cx| {
                        view.view
                            .as_ref()
                            .map(|v| v.read(cx).raw().evaluate_script(&script))
                    })
                    .is_ok_and(|r| r.is_some_and(|r| r.is_ok()))
            {
                return Ok(());
            }
            let generation = self.generation;
            let service = self.service.clone();
            let session_id = id.to_owned();
            let handle = crate::web_content::open_browser(
                "Dovo · Browser",
                url.as_str(),
                move |action| {
                    if let Err(error) = service.send(Command::BrowserAction {
                        generation,
                        id: session_id.clone(),
                        action: action.to_owned(),
                    }) {
                        eprintln!("Could not handle browser action: {error}");
                    }
                },
                cx,
            )?;
            self.browser_windows.insert(id.to_owned(), handle);
            Ok(())
        });
        if let Err(error) = result {
            let message = error.to_string();
            if let Some(handle) = self.browser_windows.get(id) {
                let script = format!(
                    "window.postMessage({},'*');",
                    json!({"channel":"dovo-browser","type":"error","message":message})
                );
                let _ = handle.update(cx, |view, _, cx| {
                    if let Some(v) = &view.view {
                        let _ = v.read(cx).raw().evaluate_script(&script);
                    }
                });
            }
            self.error = Some(message);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    #[test]
    fn browser_profile_catalog_matches_protocol_limits() {
        let mut catalog = Catalog {
            profiles: vec![
                Profile {
                    id: "default".into(),
                    name: "Default".into(),
                },
                Profile {
                    id: "work_2".into(),
                    name: "😀".repeat(50),
                },
            ],
        };
        assert!(catalog.validate().is_ok());
        catalog.profiles[1].name.push('x');
        assert!(catalog.validate().is_err());
        catalog.profiles[1].name = "Work".into();
        catalog.profiles[1].id = "../work".into();
        assert!(catalog.validate().is_err());
        catalog.profiles[1].id = "default".into();
        assert!(catalog.validate().is_err());
        catalog.profiles.remove(0);
        catalog.profiles[0].id = "work".into();
        assert!(catalog.validate().is_err());
    }
    #[test]
    fn browser_reconnect_and_close_retain_tab_and_profile_without_renavigation() {
        let session = Session {
            id: "tab".into(),
            task: "task".into(),
            profile: "work".into(),
            address: "http://localhost:3000".into(),
            closing: false,
        };
        assert_eq!(
            session.input(false),
            json!({"taskId":"task","tabId":"tab","profileId":"work"})
        );
        assert_eq!(session.input(true)["url"], "http://localhost:3000");
    }
}
