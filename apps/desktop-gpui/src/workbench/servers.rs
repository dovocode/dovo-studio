use super::*;
use crate::connection::normalize_address;
use gpui_kit::{
    assets::IconName,
    component::{
        Sizable,
        menu::{DropdownMenu, PopupMenuItem},
    },
};

#[derive(Default)]
pub(super) struct Servers {
    // Tokens from connection files and local discovery remain in memory only.
    connections: Vec<Connection>,
    tasks: HashMap<String, String>,
    pub(super) switching: bool,
}

impl Servers {
    pub(super) fn session_connections(&self, registry: &Registry) -> Vec<Connection> {
        self.connections
            .iter()
            .filter(|connection| {
                !registry
                    .profiles
                    .iter()
                    .any(|profile| profile.address == connection.address)
            })
            .cloned()
            .collect()
    }

    pub(super) fn contains(&self, address: &str) -> bool {
        self.connections
            .iter()
            .any(|connection| connection.address == address)
    }
    pub(super) fn new(initial: &[Connection]) -> anyhow::Result<Self> {
        let mut servers = Self::default();
        for connection in initial {
            let mut connection = connection.clone();
            connection.address = normalize_address(&connection.address)?;
            anyhow::ensure!(
                !connection.token.is_empty(),
                "A server needs a device token"
            );
            anyhow::ensure!(
                !servers.contains(&connection.address),
                "Load only one connection file for each server address"
            );
            servers.connections.push(connection);
        }
        Ok(servers)
    }

    pub(super) fn forget(&mut self, address: &str) {
        self.connections
            .retain(|connection| connection.address != address);
        self.tasks.remove(address);
    }
}

pub(super) fn address_label(address: &str) -> String {
    url::Url::parse(address)
        .ok()
        .and_then(|url| {
            url.host_str().map(|host| match url.port() {
                Some(port) => format!("{host}:{port}"),
                None => host.to_owned(),
            })
        })
        .unwrap_or_else(|| address.to_owned())
}

impl Workbench {
    pub(super) fn server_label(&self) -> String {
        self.registry
            .profile_at(&self.address)
            .map(|profile| profile.name.clone())
            .unwrap_or_else(|| {
                if self.address.is_empty() {
                    "Connect server".into()
                } else {
                    address_label(&self.address)
                }
            })
    }

    pub(super) fn connect_server(
        &mut self,
        mut connection: Connection,
        open_task: Option<String>,
        cx: &mut Context<Self>,
    ) {
        if self.servers.switching {
            return;
        }
        match normalize_address(&connection.address) {
            Ok(address) => connection.address = address,
            Err(error) => {
                self.error = Some(error.to_string());
                return;
            }
        }
        if !self.address.is_empty()
            && let Some(id) = self.selected_task.clone()
        {
            self.servers.tasks.insert(self.address.clone(), id.clone());
            // Queue the final composer value before Connect changes the credential scope.
            self.command(Command::SaveDraft {
                generation: self.generation,
                id,
                text: self.composer.read(cx).value().to_string(),
            });
        }
        let open_task = open_task.or_else(|| self.servers.tasks.get(&connection.address).cloned());
        if let Some(existing) = self
            .servers
            .connections
            .iter_mut()
            .find(|existing| existing.address == connection.address)
        {
            *existing = connection.clone();
        } else {
            self.servers.connections.push(connection.clone());
        }
        self.servers.switching = true;
        self.online = false;
        self.status = "Switching server…".into();
        self.command(Command::Connect {
            connection,
            open_task,
        });
        cx.notify();
    }

    pub(super) fn switch_server(
        &mut self,
        address: &str,
        open_task: Option<String>,
        cx: &mut Context<Self>,
    ) {
        if self.servers.switching || address == self.address && self.online {
            return;
        }
        let profile = self.registry.profile_at(address).cloned();
        let connection = match &profile {
            Some(profile) => self.storage.connection(profile),
            None => self
                .servers
                .connections
                .iter()
                .find(|connection| connection.address == address)
                .cloned()
                .ok_or_else(|| anyhow::anyhow!("Pair this server before connecting")),
        };
        match connection {
            Ok(connection) => {
                let mut registry = self.registry.clone();
                registry.active_id = profile.map(|profile| profile.id);
                if let Err(error) = self.storage.write(&registry) {
                    self.error = Some(error.to_string());
                    return;
                }
                self.registry = registry;
                self.page = Page::Tasks;
                self.new_task = false;
                self.search_open = false;
                self.connect_server(connection, open_task, cx);
            }
            Err(error) => self.error = Some(error.to_string()),
        }
        cx.notify();
    }

    pub(super) fn server_picker(&self, cx: &mut Context<Self>) -> AnyElement {
        let mut choices = Vec::new();
        for profile in &self.registry.profiles {
            if !choices
                .iter()
                .any(|(_, address)| address == &profile.address)
                && let Some(selected) = self.registry.profile_at(&profile.address)
            {
                choices.push((selected.name.clone(), selected.address.clone()));
            }
        }
        for connection in &self.servers.connections {
            let address = &connection.address;
            if !choices.iter().any(|(_, known)| known == address) {
                choices.push((address_label(address), address.clone()));
            }
        }
        let mut icons: HashMap<String, IconName> = self
            .fleet_entries
            .iter()
            .filter_map(|entry| {
                entry.result.as_ref().ok().map(|summary| {
                    (
                        entry.address.clone(),
                        shell::server_icon(&summary.runtime_icon),
                    )
                })
            })
            .collect();
        icons.insert(self.address.clone(), self.runtime_icon());
        let current = self.address.clone();
        let entity = cx.entity();
        Button::new("server-picker")
            .ghost()
            .small()
            .icon(self.runtime_icon())
            .label(self.server_label())
            .dropdown_caret(true)
            .max_w(px(180.))
            .disabled(self.servers.switching)
            .tooltip("Switch server or pair another computer")
            .dropdown_menu(move |mut menu, _, _| {
                menu = menu
                    .min_w(px(260.))
                    .max_w(px(420.))
                    .max_h(px(320.))
                    .scrollable(true)
                    .label("Servers");
                for (name, address) in &choices {
                    let icon = icons.get(address).copied().unwrap_or(IconName::Monitor);
                    let address = address.clone();
                    let selected = current == address;
                    let entity = entity.clone();
                    menu = menu.item(
                        PopupMenuItem::new(if name == &address_label(&address) {
                            address.clone()
                        } else {
                            format!("{name} · {address}")
                        })
                        .icon(icon)
                        .checked(selected)
                        .on_click(move |_, _, cx| {
                            entity.update(cx, |this, cx| this.switch_server(&address, None, cx));
                        }),
                    );
                }
                let entity = entity.clone();
                menu.separator().item(
                    PopupMenuItem::new("Add or manage servers…")
                        .icon(IconName::Plus)
                        .on_click(move |_, _, cx| {
                            entity.update(cx, |this, cx| this.navigate(Page::Computers, cx));
                        }),
                )
            })
            .into_any_element()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    #[test]
    fn session_servers_normalize_addresses_and_reject_ambiguous_credentials() {
        let connection = |address: &str| Connection {
            address: address.into(),
            token: "device-token".into(),
        };
        let servers = Servers::new(&[
            connection("http://lan-one:8787/"),
            connection("lan-two:8787"),
        ])
        .unwrap();
        assert_eq!(servers.connections.len(), 2);
        assert!(servers.contains("http://lan-two:8787"));
        assert_eq!(servers.connections[0].address, "http://lan-one:8787");
        assert!(
            Servers::new(&[
                connection("http://lan-one:8787/"),
                connection("lan-one:8787")
            ])
            .is_err()
        );
        assert_eq!(address_label("http://lan-one:8787"), "lan-one:8787");
    }
}
