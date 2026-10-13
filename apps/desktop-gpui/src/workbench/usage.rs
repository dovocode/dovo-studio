use super::*;
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct History {
    records: Vec<Record>,
    notices: Vec<String>,
    pricing_updated_at: Option<String>,
    #[serde(default)]
    overrides: BTreeMap<String, Price>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Record {
    task_id: String,
    title: String,
    origin: Option<String>,
    turn: crate::model::Turn,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Price {
    input: f64,
    output: f64,
    cache_read: f64,
    cache_write: f64,
}
impl Workbench {
    pub(super) fn read_usage(&mut self, force: bool) {
        let since =
            (chrono::Utc::now() - chrono::Duration::days(i64::from(self.usage_days))).to_rfc3339();
        self.request(
            "usage-history",
            "/api/usage/history/read",
            json!({"since":since,"force":force}),
        );
    }
    pub(super) fn usage_page(&mut self, window: &mut Window, cx: &mut Context<Self>) -> AnyElement {
        let mut root=div().id("usage-page").flex().flex_col().flex_1().overflow_y_scroll().p_5().gap_4()
            .child(Self::header("Usage","Reported tokens and estimated standard API cost, including discovered CLI sessions. Estimates do not represent subscription charges."));
        root = root.child(
            div()
                .flex()
                .gap_2()
                .children([1, 7, 30, 90].into_iter().map(|days| {
                    Button::new(SharedString::from(format!("usage-days-{days}")))
                        .label(format!("{days} days"))
                        .selected(self.usage_days == days)
                        .disabled(self.pending.contains("usage-history"))
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.usage_days = days;
                            this.read_usage(false);
                            cx.notify();
                        }))
                }))
                .child(
                    Button::new("refresh-usage")
                        .label("Refresh usage & rates")
                        .disabled(self.pending.contains("usage-history"))
                        .on_click(cx.listener(|this, _, _, cx| {
                            this.read_usage(true);
                            cx.notify();
                        })),
                ),
        );
        let history: History = match self.responses.get("usage-history") {
            Some(value) => match serde_json::from_value(value.clone()) {
                Ok(history) => history,
                Err(error) => {
                    return root
                        .child(format!("Invalid usage data: {error}"))
                        .into_any_element();
                }
            },
            None => return root.child("Loading usage…").into_any_element(),
        };
        for notice in history.notices {
            root = root.child(notice);
        }
        if let Some(at) = history.pricing_updated_at {
            root = root.child(format!("Rates updated: {at}"));
        }
        let mut models: BTreeMap<String, (f64, f64, usize, usize)> = BTreeMap::new();
        for record in &history.records {
            let entry = models.entry(record.turn.model.clone()).or_default();
            entry.0 += record.turn.tokens.unwrap_or(0.);
            entry.1 += record.turn.estimated_cost_usd.unwrap_or(0.);
            entry.2 += 1;
            entry.3 += usize::from(record.turn.estimated_cost_usd.is_none());
        }
        let tokens: f64 = models.values().map(|value| value.0).sum();
        let cost: f64 = models.values().map(|value| value.1).sum();
        let unpriced: usize = models.values().map(|value| value.3).sum();
        root = root.child(format!(
            "{} turns · {tokens:.0} reported tokens · ${cost:.4} reported estimated API cost · {unpriced} turns without cost",
            history.records.len()
        ));
        for (model, (tokens, cost, turns, unpriced)) in models {
            root = root.child(
                div()
                    .p_3()
                    .border_1()
                    .border_color(cx.theme().border)
                    .rounded_md()
                    .child(format!(
                        "{model} · {turns} turns · {tokens:.0} tokens · ${cost:.4} reported cost · {unpriced} unpriced"
                    )),
            );
        }
        root = root.child(Self::header(
            "History",
            "Latest activity first. Missing provider usage remains unreported.",
        ));
        let mut records = history.records;
        records.sort_by(|a, b| b.turn.started_at.cmp(&a.turn.started_at));
        for record in records.iter().take(300) {
            let id = record.task_id.clone();
            let local = self
                .snapshot
                .as_ref()
                .is_some_and(|snapshot| snapshot.workspace.tasks.iter().any(|task| task.id == id));
            let mut row = div()
                .p_3()
                .border_b_1()
                .border_color(cx.theme().border)
                .flex()
                .flex_col()
                .gap_1()
                .child(format!(
                    "{} · {} · {} · {}",
                    record.turn.started_at,
                    record.turn.provider.name(),
                    record.turn.model,
                    record.origin.as_deref().unwrap_or("dovo")
                ))
                .child(format!(
                    "{} · {} tokens · {}",
                    record.title,
                    record
                        .turn
                        .tokens
                        .map(|tokens| format!("{tokens:.0}"))
                        .unwrap_or_else(|| "unreported".into()),
                    record
                        .turn
                        .estimated_cost_usd
                        .map(|cost| format!("${cost:.4}"))
                        .unwrap_or_else(|| "cost unreported".into())
                ));
            if local {
                row = row.child(
                    Button::new(SharedString::from(format!("usage-task-{}", record.turn.id)))
                        .ghost()
                        .label("Open task")
                        .on_click(cx.listener(move |this, _, window, cx| {
                            this.select_task(id.clone(), window, cx)
                        })),
                );
            }
            root = root.child(row);
        }
        if records.len() > 300 {
            root = root.child(format!(
                "Showing the latest 300 of {} turns. Totals include all returned records.",
                records.len()
            ));
        }
        root=root.child(Self::header("Model rate override","Prices per million tokens. Blank cache rates use the input rate. Save replaces the override for this exact model ID."));
        root = root.child(self.field(
            "price-model",
            "Model ID",
            "",
            "Exact provider model ID",
            window,
            cx,
        ));
        for (field, label) in [
            ("input", "Input"),
            ("output", "Output"),
            ("cacheRead", "Cache read"),
            ("cacheWrite", "Cache write"),
        ] {
            root = root.child(self.field(
                &format!("price-{field}"),
                label,
                "",
                "USD per million tokens",
                window,
                cx,
            ));
        }
        root=root.child(Button::new("save-price").label("Save override").disabled(!self.online||self.pending.contains("usage-price-save")).on_click(cx.listener(|this,_,_,cx|{
            let model=this.value("price-model",cx);
            let input=rate(&this.value("price-input",cx));let output=rate(&this.value("price-output",cx));
            let cache_read=this.value("price-cacheRead",cx);let cache_write=this.value("price-cacheWrite",cx);
            match (input,output){
                (Ok(input),Ok(output)) if !model.trim().is_empty()=>{
                    let cache_read=if cache_read.trim().is_empty(){Ok(input)}else{rate(&cache_read)};
                    let cache_write=if cache_write.trim().is_empty(){Ok(input)}else{rate(&cache_write)};
                    match(cache_read,cache_write){
                        (Ok(cache_read),Ok(cache_write))=>this.request("usage-price-save","/api/usage/prices/write",json!({"model":model.trim(),"price":{"input":input,"output":output,"cacheRead":cache_read,"cacheWrite":cache_write}})),
                        _=>this.error=Some("Enter finite, non-negative cache rates".into()),
                    }
                }
                _=>this.error=Some("Choose a model ID and finite, non-negative input/output rates".into()),
            }
            cx.notify();
        })));
        for (model, price) in history.overrides {
            let remove = model.clone();
            root = root.child(
                div()
                    .flex()
                    .justify_between()
                    .child(format!(
                        "{model}: input {} · output {} · cache read {} · cache write {}",
                        price.input, price.output, price.cache_read, price.cache_write
                    ))
                    .child(
                        Button::new(SharedString::from(format!("remove-price-{model}")))
                            .ghost()
                            .label("Remove override")
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.request(
                                    "usage-price-save",
                                    "/api/usage/prices/write",
                                    json!({"model":remove}),
                                );
                                cx.notify();
                            })),
                    ),
            );
        }
        root.into_any_element()
    }
}
fn rate(value: &str) -> anyhow::Result<f64> {
    let rate = value.trim().replace(',', ".").parse::<f64>()?;
    anyhow::ensure!(rate.is_finite() && rate >= 0., "Invalid rate");
    Ok(rate)
}
#[cfg(test)]
mod tests {
    use super::rate;
    use core::prelude::v1::test;
    #[test]
    fn rate_validation_preserves_zero_and_rejects_non_finite_values() {
        assert_eq!(rate("0").unwrap(), 0.);
        assert_eq!(rate("1,25").unwrap(), 1.25);
        for invalid in ["NaN", "inf", "-1", ""] {
            assert!(rate(invalid).is_err());
        }
    }
}
