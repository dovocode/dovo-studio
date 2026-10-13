use super::*;
use sha2::{Digest, Sha256};

pub(super) struct CachedDiff {
    fingerprint: [u8; 32],
    state: Entity<DiffState>,
}
fn language(path: &str) -> &'static str {
    match std::path::Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
    {
        "rs" => "rust",
        "ts" | "tsx" => "typescript",
        "js" | "jsx" | "mjs" | "cjs" => "javascript",
        "json" => "json",
        "py" => "python",
        "html" => "html",
        "css" | "scss" => "css",
        "md" => "markdown",
        "sh" | "bash" => "bash",
        "toml" => "toml",
        "yaml" | "yml" => "yaml",
        "go" => "go",
        "sql" => "sql",
        "swift" => "swift",
        "c" | "h" => "c",
        "cpp" | "hpp" => "cpp",
        _ => "plain",
    }
}
fn file_patch(before: &str, after: &str) -> String {
    similar::TextDiff::configure()
        .timeout(std::time::Duration::from_millis(100))
        .diff_lines(before, after)
        .unified_diff()
        .header("a/file", "b/file")
        .to_string()
}
impl Workbench {
    pub(super) fn code_editor(
        &mut self,
        key: &str,
        path: &str,
        contents: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Entity<EditorState> {
        if let Some(editor) = self.editors.get(key) {
            return editor.clone();
        }
        let editor = cx.new(|cx| {
            EditorState::new(window, cx)
                .language(language(path))
                .default_value(contents.to_owned())
        });
        cx.subscribe(&editor, |_, _, _: &InputEvent, cx| cx.notify())
            .detach();
        self.editors.insert(key.to_owned(), editor.clone());
        editor
    }
    pub(super) fn code_value(&self, key: &str, cx: &App) -> String {
        self.editors
            .get(key)
            .map(|editor| editor.read(cx).value().to_string())
            .unwrap_or_default()
    }
    pub(super) fn changed_file_diff(
        &mut self,
        key: &str,
        path: &str,
        before: &str,
        after: &str,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let mut hasher = Sha256::new();
        hasher.update(before.len().to_le_bytes());
        hasher.update(before);
        hasher.update(after);
        let fingerprint = hasher.finalize().into();
        if let Some(cache) = self.diffs.get(key)
            && cache.fingerprint == fingerprint
        {
            return div()
                .flex_shrink_0()
                .h(px(320.))
                .child(Diff::new(&cache.state).header_visible(false))
                .into_any_element();
        }
        let patch = file_patch(before, after);
        self.cache_diff(key, path, &patch, fingerprint, cx)
    }
    pub(super) fn patch_diff(
        &mut self,
        key: &str,
        path: &str,
        patch: &str,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let fingerprint = Sha256::digest(patch.as_bytes()).into();
        if let Some(cache) = self.diffs.get(key)
            && cache.fingerprint == fingerprint
        {
            return div()
                .flex_shrink_0()
                .h(px(320.))
                .child(Diff::new(&cache.state).header_visible(false))
                .into_any_element();
        }
        self.cache_diff(key, path, patch, fingerprint, cx)
    }
    fn cache_diff(
        &mut self,
        key: &str,
        path: &str,
        patch: &str,
        fingerprint: [u8; 32],
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let files = match DiffFile::parse(patch) {
            Ok(files) => files
                .into_iter()
                .map(|file| file.with_language(language(path)))
                .collect::<Vec<_>>(),
            Err(error) => return Self::empty("Could not display the patch", &error.to_string()),
        };
        let state = cx.new(|cx| DiffState::new(files, cx));
        let element = div()
            .flex_shrink_0()
            .h(px(320.))
            .child(Diff::new(&state).header_visible(false))
            .into_any_element();
        self.diffs
            .insert(key.to_owned(), CachedDiff { fingerprint, state });
        element
    }
}

#[cfg(test)]
mod tests {
    use super::file_patch;
    use core::prelude::v1::test;
    use gpui_kit::component::diff::DiffFile;
    #[test]
    fn native_patch_preserves_unicode_and_missing_final_newlines() {
        let patch = file_patch("old 🦀\nunchanged\n", "new 🦀\nunchanged");
        let files = DiffFile::parse(&patch).unwrap();
        assert_eq!(files.len(), 1);
        assert!(patch.contains("-old 🦀"));
        assert!(patch.contains("+new 🦀"));
        assert!(patch.contains("No newline at end of file"));
    }
}
