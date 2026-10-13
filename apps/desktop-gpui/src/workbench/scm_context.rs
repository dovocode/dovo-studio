use super::*;

#[derive(Default)]
pub(super) struct SourceContexts {
    epoch: u64,
    origins: HashMap<String, Value>,
    requests: HashMap<String, (u64, String, Value)>,
}
impl SourceContexts {
    fn remember(&mut self, key: &str, source: String, origin: Value) -> anyhow::Result<()> {
        if let Some(previous) = self.origins.get(&source) {
            anyhow::ensure!(
                previous == &origin,
                "The source account or project changed. Reload source views before continuing; your draft has been kept."
            );
        }
        self.origins.insert(source.clone(), origin.clone());
        self.requests
            .insert(key.into(), (self.epoch, source, origin));
        Ok(())
    }
    fn accept(&mut self, key: &str, current: Option<(String, Value)>) -> bool {
        self.requests
            .remove(key)
            .is_none_or(|(epoch, source, origin)| {
                epoch == self.epoch && current == Some((source, origin))
            })
    }
    fn reset(&mut self) {
        self.epoch += 1;
        self.origins.clear();
        // Keep receipts until outstanding requests settle so old responses are rejected.
    }
}
impl Workbench {
    pub(super) fn source_epoch(&self) -> u64 {
        self.source_contexts.epoch
    }
    fn source_origin(&self, source: &str) -> Option<Value> {
        let snapshot = self.snapshot.as_ref()?;
        if let Some(id) = source.strip_prefix("jira:") {
            let value = snapshot
                .workspace
                .extra
                .get("jiraSources")?
                .as_array()?
                .iter()
                .find(|source| source.get("id").and_then(Value::as_str) == Some(id))?;
            return Some(value.clone());
        }
        let repo = snapshot
            .workspace
            .repositories
            .iter()
            .find(|repo| repo.id == source)?;
        Some(
            json!({"path":repo.path,"kind":repo.kind,"forge":repo.extra.get("forge"),"pullIdentity":repo.extra.get("pullIdentity"),"gitIdentity":repo.extra.get("gitIdentity")}),
        )
    }
    pub(super) fn capture_source_request(
        &mut self,
        key: &str,
        path: &str,
        input: &Value,
    ) -> anyhow::Result<()> {
        if !(path.starts_with("/api/scm/") || path.starts_with("/api/agents/"))
            || path == "/api/scm/repositories/forge/bind"
        {
            return Ok(());
        }
        let source = input
            .get("jiraSourceId")
            .and_then(Value::as_str)
            .map(|id| format!("jira:{id}"))
            .or_else(|| {
                input
                    .get("repositoryId")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
            });
        if let Some(source) = source {
            let origin = self
                .source_origin(&source)
                .ok_or_else(|| anyhow::anyhow!("The selected source is no longer available"))?;
            self.source_contexts.remember(key, source, origin)?;
        }
        Ok(())
    }
    pub(super) fn accept_source_response(&mut self, key: &str) -> bool {
        let source = self
            .source_contexts
            .requests
            .get(key)
            .map(|(_, source, _)| source.clone());
        let current =
            source.and_then(|source| self.source_origin(&source).map(|origin| (source, origin)));
        self.source_contexts.accept(key, current)
    }
    pub(super) fn source_reload_button(&self, cx: &mut Context<Self>) -> AnyElement {
        let changed = self
            .source_contexts
            .origins
            .iter()
            .any(|(source, origin)| self.source_origin(source).as_ref() != Some(origin));
        if !changed {
            return div().into_any_element();
        }
        div().flex().flex_col().gap_2().child("The source account or project changed. Reload these views before applying changes.")
            .child(Button::new("source-context-reload").label("Reload source views…").on_click(cx.listener(|this,_,window,cx| {
                let generation = this.generation;
                let epoch = this.source_contexts.epoch;
                let prompt = window.prompt(PromptLevel::Warning,"Reload source views?",Some("Discard unsaved source views, agent configurations and task settings and load the current sources. Task composer drafts and source-account settings are kept."),&["Keep drafts","Reload"],cx);
                cx.spawn(async move |this,cx| {if prompt.await == Ok(1) {let _ = this.update(cx,|this,cx| {
                    if this.generation != generation || this.source_contexts.epoch != epoch {return;}
                    this.source_contexts.reset();
                    this.work_lists.clear(); this.work_form = None; this.selected_work = None; this.selected_pull = None;
                    this.work_issue_baselines.clear(); this.work_issue_rebase.clear(); this.work_task_requests.clear();
                    let discard = |key: &str| ["work-","issue-","pull-","project-branches:","project-branch:","project-defaults:","task-defaults:","task-agents:","scoped-agent","defaults-save:","resources:"].iter().any(|prefix| key.starts_with(prefix));
                    this.responses.retain(|key,_| !discard(key));
                    this.inputs.retain(|key,_| !discard(key)); this.textareas.retain(|key,_| !discard(key));
                    this.scm_editor_baselines.retain(|key,_| !discard(key));
                    this.work_form_submissions.clear();this.agent_submissions.clear();this.scoped_agent_editor=None;this.staged_resources.clear();this.defaults_prompts.clear();
                    this.notice = Some("Source views reloaded; select a source to load its current data".into());
                    cx.notify();
                });}}).detach();
            }))).into_any_element()
    }
}
#[cfg(test)]
mod tests {
    use super::SourceContexts;
    use serde_json::json;
    #[test]
    fn changed_binding_cannot_apply_a_draft_or_deliver_an_old_response() {
        let mut contexts = SourceContexts::default();
        let old = json!({"forge":{"connectionId":"old","repository":"team/project"}});
        let new = json!({"forge":{"connectionId":"new","repository":"team/project"}});
        contexts
            .remember("detail", "repo".into(), old.clone())
            .unwrap();
        assert!(
            contexts
                .remember("save", "repo".into(), new.clone())
                .is_err()
        );
        assert!(!contexts.accept("detail", Some(("repo".into(), new.clone()))));
        contexts.remember("pending", "repo".into(), old).unwrap();
        contexts.reset();
        assert!(!contexts.accept("pending", Some(("repo".into(), new.clone()))));
        contexts
            .remember("fresh", "repo".into(), new.clone())
            .unwrap();
        assert!(contexts.accept("fresh", Some(("repo".into(), new))));
    }
}
