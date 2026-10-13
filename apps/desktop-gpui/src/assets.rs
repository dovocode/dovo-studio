use gpui_kit::{AssetSource, SharedString};
use std::{borrow::Cow, collections::BTreeMap};

pub struct AppAssets {
    harness: BTreeMap<String, String>,
}
impl AppAssets {
    pub fn new() -> anyhow::Result<Self> {
        Ok(Self {
            harness: serde_json::from_str(include_str!("../assets/harness-icons.json"))?,
        })
    }
}
impl AssetSource for AppAssets {
    fn load(&self, path: &str) -> anyhow::Result<Option<Cow<'static, [u8]>>> {
        if let Some(svg) = self.harness.get(path) {
            return Ok(Some(Cow::Owned(svg.as_bytes().to_vec())));
        }
        gpui_kit::assets::AllAssets.load(path)
    }
    fn list(&self, path: &str) -> anyhow::Result<Vec<SharedString>> {
        let mut assets = gpui_kit::assets::AllAssets.list(path)?;
        assets.extend(
            self.harness
                .keys()
                .filter(|key| key.starts_with(path))
                .cloned()
                .map(Into::into),
        );
        Ok(assets)
    }
}
