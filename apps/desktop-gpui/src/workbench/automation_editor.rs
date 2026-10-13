use super::*;
use serde::{Deserialize, Serialize};

#[derive(Clone, Deserialize, Serialize)]
pub(super) struct FlowNode {
    id: String,
    #[serde(rename = "type")]
    node_type: String,
    position: Position,
    data: NodeData,
}
#[derive(Clone, Deserialize, Serialize)]
struct Position {
    x: f32,
    y: f32,
}
#[derive(Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum NodeKind {
    Trigger,
    Task,
    Review,
}
impl NodeKind {
    fn label(self) -> &'static str {
        match self {
            Self::Trigger => "Trigger",
            Self::Task => "Agent task",
            Self::Review => "Human review",
        }
    }
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct NodeData {
    kind: NodeKind,
    label: String,
    trigger: String,
    schedule: String,
    timezone: String,
    objective: String,
    agent_id: String,
    repository_id: String,
    #[serde(flatten)]
    extra: serde_json::Map<String, Value>,
}
#[derive(Clone, Deserialize, Serialize)]
struct Edge {
    id: String,
    source: String,
    target: String,
}
pub(super) struct GraphDraft {
    id: String,
    name: String,
    before_name: String,
    before_nodes: Value,
    before_edges: Value,
    nodes: Vec<FlowNode>,
    edges: Vec<Edge>,
    selected: Option<String>,
    connection: Option<String>,
    drag: Option<Point<Pixels>>,
    submitted: Option<(String, Value, Value)>,
}
impl GraphDraft {
    pub(super) fn from_automation(flow: &crate::model::Automation) -> anyhow::Result<Self> {
        let before_nodes = flow
            .extra
            .get("nodes")
            .context("Workflow has no nodes")?
            .clone();
        let before_edges = flow
            .extra
            .get("edges")
            .context("Workflow has no connections")?
            .clone();
        let nodes: Vec<FlowNode> = serde_json::from_value(before_nodes.clone())?;
        anyhow::ensure!(
            nodes
                .iter()
                .all(|node| node.position.x.is_finite() && node.position.y.is_finite()),
            "Workflow contains invalid node positions"
        );
        Ok(Self {
            id: flow.id.clone(),
            name: flow.name.clone(),
            before_name: flow.name.clone(),
            before_nodes,
            before_edges: before_edges.clone(),
            nodes,
            edges: serde_json::from_value(before_edges)?,
            selected: None,
            connection: None,
            drag: None,
            submitted: None,
        })
    }
    pub(super) fn acknowledge_save_for(&mut self, id: &str) {
        if self.id != id {
            return;
        }
        if let Some((name, nodes, edges)) = self.submitted.take() {
            self.before_name = name;
            self.before_nodes = nodes;
            self.before_edges = edges;
        }
    }
    fn add(&mut self, kind: NodeKind) {
        let id = uuid::Uuid::new_v4().to_string();
        self.nodes.push(FlowNode {
            id: id.clone(),
            node_type: "automation".into(),
            position: Position {
                x: 40. + (self.nodes.len() % 4) as f32 * 260.,
                y: 40. + (self.nodes.len() / 4) as f32 * 140.,
            },
            data: NodeData {
                kind,
                label: kind.label().into(),
                trigger: "manual".into(),
                schedule: String::new(),
                timezone: "UTC".into(),
                objective: String::new(),
                agent_id: String::new(),
                repository_id: String::new(),
                extra: serde_json::Map::new(),
            },
        });
        self.selected = Some(id);
    }
    fn remove(&mut self, id: &str) {
        self.nodes.retain(|node| node.id != id);
        self.edges
            .retain(|edge| edge.source != id && edge.target != id);
        if self.selected.as_deref() == Some(id) {
            self.selected = None;
        }
        if self.connection.as_deref() == Some(id) {
            self.connection = None;
        }
    }
}
use anyhow::Context as _;

impl Workbench {
    pub(super) fn edit_automation(&mut self, flow: &crate::model::Automation) {
        match GraphDraft::from_automation(flow) {
            Ok(draft) => self.graph = Some(draft),
            Err(error) => self.error = Some(error.to_string()),
        }
    }
    pub(super) fn automation_editor(
        &mut self,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let Some(draft) = self.graph.as_ref() else {
            return Self::empty("Choose a workflow", "Select a workflow to edit.");
        };
        let id = draft.id.clone();
        let name = draft.name.clone();
        let nodes = draft.nodes.clone();
        let edges = draft.edges.clone();
        let selected = draft.selected.clone();
        let name_key = format!("graph-name:{id}");
        let mut root=div().id("automation-editor").flex().flex_col().flex_1().overflow_y_scroll().p_5().gap_4()
            .child(Self::header("Workflow editor","Drag nodes to arrange them. Select Output, then Input to connect two nodes. Save node settings before saving the workflow."))
            .child(self.field(&name_key,"Name",&name,"Workflow name",window,cx));
        let mut toolbar = div().flex().gap_2().child(
            Button::new("workflow-back")
                .ghost()
                .label("Back to workflows")
                .on_click(cx.listener(|this, _, window, cx| {
                    let generation = this.generation;
                    let flow = this.graph.as_ref().map(|draft| draft.id.clone());
                    let prompt = window.prompt(
                        PromptLevel::Warning,
                        "Leave workflow editor?",
                        Some("Any changes you have not saved will be discarded."),
                        &["Keep editing", "Leave editor"],
                        cx,
                    );
                    cx.spawn(async move |this, cx| {
                        if prompt.await == Ok(1) {
                            let _ = this.update(cx, |this, cx| {
                                if this.generation == generation
                                    && this.graph.as_ref().map(|draft| draft.id.clone()) == flow
                                {
                                    this.graph = None;
                                    cx.notify();
                                }
                            });
                        }
                    })
                    .detach();
                })),
        );
        for kind in [NodeKind::Trigger, NodeKind::Task, NodeKind::Review] {
            toolbar = toolbar.child(
                Button::new(kind.label())
                    .label(format!("Add {}", kind.label()))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        if let Some(draft) = &mut this.graph {
                            draft.add(kind);
                        }
                        cx.notify();
                    })),
            );
        }
        toolbar = toolbar.child(
            Button::new("save-workflow")
                .primary()
                .label("Save workflow")
                .disabled(!self.online || self.pending.contains(&format!("graph-save:{id}")))
                .on_click(cx.listener(move |this, _, _, cx| {
                    let name = this.value(&name_key, cx);
                    if name.trim().is_empty() {
                        this.error = Some("Enter a workflow name".into());
                        cx.notify();
                        return;
                    }
                    if let Some(draft) = &mut this.graph {
                        draft.submitted =
                            Some((name.clone(), json!(draft.nodes), json!(draft.edges)));
                        let changes = [
                            ("name", json!(draft.before_name), json!(name)),
                            ("nodes", draft.before_nodes.clone(), json!(draft.nodes)),
                            ("edges", draft.before_edges.clone(), json!(draft.edges)),
                        ]
                        .into_iter()
                        .filter(|(_, before, after)| before != after)
                        .map(|(key, before, after)| {
                            (key.to_owned(), crate::model::FieldChange { before, after })
                        })
                        .collect();
                        let id = draft.id.clone();
                        this.patch(
                            format!("graph-save:{id}"),
                            WorkspacePatch {
                                collection: "automations",
                                id,
                                changes,
                                create: None,
                            },
                        );
                    }
                    cx.notify();
                })),
        );
        root = root.child(toolbar);
        let width = nodes
            .iter()
            .map(|node| node.position.x + 240.)
            .fold(1100., f32::max)
            .clamp(1100., 6000.);
        let height = nodes
            .iter()
            .map(|node| node.position.y + 130.)
            .fold(420., f32::max)
            .clamp(420., 6000.);
        let paint_nodes = nodes.clone();
        let paint_edges = edges.clone();
        let mut graph = div()
            .relative()
            .w(px(width))
            .h(px(height))
            .bg(cx.theme().muted)
            .child(
                canvas(
                    move |bounds, _, _| bounds,
                    move |_, bounds, window, _| {
                        for edge in &paint_edges {
                            let source = paint_nodes.iter().find(|node| node.id == edge.source);
                            let target = paint_nodes.iter().find(|node| node.id == edge.target);
                            if let (Some(source), Some(target)) = (source, target) {
                                let mut path = PathBuilder::stroke(px(2.));
                                path.move_to(
                                    bounds.origin
                                        + point(
                                            px(source.position.x + 220.),
                                            px(source.position.y + 50.),
                                        ),
                                );
                                path.line_to(
                                    bounds.origin
                                        + point(px(target.position.x), px(target.position.y + 50.)),
                                );
                                if let Ok(path) = path.build() {
                                    window.paint_path(path, rgb(0x7282a5));
                                }
                            }
                        }
                    },
                )
                .absolute()
                .top_0()
                .left_0()
                .size_full(),
            );
        for node in &nodes {
            let node_id = node.id.clone();
            let input_id = node.id.clone();
            let output_id = node.id.clone();
            let remove_id = node.id.clone();
            graph = graph.child(
                div()
                    .id(SharedString::from(format!("graph-node-{}", node.id)))
                    .absolute()
                    .left(px(node.position.x))
                    .top(px(node.position.y))
                    .w(px(220.))
                    .p_3()
                    .rounded_md()
                    .border_1()
                    .border_color(if selected.as_ref() == Some(&node.id) {
                        cx.theme().primary
                    } else {
                        cx.theme().border
                    })
                    .bg(cx.theme().secondary)
                    .flex()
                    .flex_col()
                    .gap_2()
                    .child(
                        div()
                            .cursor_pointer()
                            .child(format!("{} · {}", node.data.kind.label(), node.data.label))
                            .on_mouse_down(
                                MouseButton::Left,
                                cx.listener(move |this, event: &MouseDownEvent, _, cx| {
                                    if let Some(draft) = &mut this.graph {
                                        draft.selected = Some(node_id.clone());
                                        draft.drag = Some(event.position);
                                    }
                                    cx.notify();
                                }),
                            ),
                    )
                    .child(
                        div()
                            .flex()
                            .gap_2()
                            .child(
                                Button::new(SharedString::from(format!("input-{}", node.id)))
                                    .ghost()
                                    .label("Input")
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        if let Some(draft) = &mut this.graph
                                            && let Some(source) = draft.connection.take()
                                            && source != input_id
                                            && !draft.edges.iter().any(|edge| {
                                                edge.source == source && edge.target == input_id
                                            })
                                        {
                                            draft.edges.push(Edge {
                                                id: uuid::Uuid::new_v4().to_string(),
                                                source,
                                                target: input_id.clone(),
                                            });
                                        }
                                        cx.notify();
                                    })),
                            )
                            .child(
                                Button::new(SharedString::from(format!("output-{}", node.id)))
                                    .ghost()
                                    .label("Output")
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        if let Some(draft) = &mut this.graph {
                                            draft.connection = Some(output_id.clone());
                                        }
                                        cx.notify();
                                    })),
                            )
                            .child(
                                Button::new(SharedString::from(format!("remove-{}", node.id)))
                                    .ghost()
                                    .label("×")
                                    .on_click(cx.listener(move |this, _, _, cx| {
                                        if let Some(draft) = &mut this.graph {
                                            draft.remove(&remove_id);
                                        }
                                        cx.notify();
                                    })),
                            ),
                    ),
            );
        }
        root = root.child(
            div()
                .id("graph-scroll")
                .h(px(440.))
                .flex_shrink_0()
                .overflow_scroll()
                .child(graph)
                .on_mouse_move(cx.listener(|this, event: &MouseMoveEvent, _, cx| {
                    if let Some(draft) = &mut this.graph {
                        if event.dragging()
                            && let Some(previous) = draft.drag
                            && let Some(node) = draft
                                .nodes
                                .iter_mut()
                                .find(|node| Some(&node.id) == draft.selected.as_ref())
                        {
                            node.position.x = (node.position.x
                                + f32::from(event.position.x - previous.x))
                            .clamp(0., 5700.);
                            node.position.y = (node.position.y
                                + f32::from(event.position.y - previous.y))
                            .clamp(0., 5700.);
                            draft.drag = Some(event.position);
                            cx.notify();
                        } else if !event.dragging() {
                            draft.drag = None;
                        }
                    }
                })),
        );
        for edge in &edges {
            let edge_id = edge.id.clone();
            let source = nodes
                .iter()
                .find(|node| node.id == edge.source)
                .map(|node| node.data.label.as_str())
                .unwrap_or("Missing node");
            let target = nodes
                .iter()
                .find(|node| node.id == edge.target)
                .map(|node| node.data.label.as_str())
                .unwrap_or("Missing node");
            root = root.child(
                Button::new(SharedString::from(format!("edge-{edge_id}")))
                    .ghost()
                    .label(format!("{source} → {target} · Remove connection"))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        if let Some(draft) = &mut this.graph {
                            draft.edges.retain(|edge| edge.id != edge_id);
                        }
                        cx.notify();
                    })),
            );
        }
        if let Some(node) = nodes
            .iter()
            .find(|node| Some(&node.id) == selected.as_ref())
        {
            root = root.child(self.automation_node_fields(&id, node, window, cx));
        }
        root.into_any_element()
    }
    fn automation_node_fields(
        &mut self,
        flow: &str,
        node: &FlowNode,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> AnyElement {
        let prefix = format!("graph:{flow}:{}", node.id);
        let mut root = div()
            .flex()
            .flex_col()
            .gap_3()
            .p_4()
            .border_1()
            .border_color(cx.theme().border)
            .rounded_md()
            .child(Self::header(
                node.data.kind.label(),
                "Settings for the selected node.",
            ))
            .child(self.field(
                &format!("{prefix}:label"),
                "Label",
                &node.data.label,
                "Node label",
                window,
                cx,
            ));
        if node.data.kind == NodeKind::Trigger {
            root = root
                .child(self.field(
                    &format!("{prefix}:trigger"),
                    "Trigger",
                    &node.data.trigger,
                    "manual",
                    window,
                    cx,
                ))
                .child(
                    self.work_field_choices(
                        &format!("{prefix}:trigger"),
                        &["manual", "schedule", "webhook", "github"]
                            .into_iter()
                            .map(str::to_owned)
                            .collect::<Vec<_>>(),
                        cx,
                    ),
                );
            let trigger = self.value(&format!("{prefix}:trigger"), cx);
            if trigger == "schedule" {
                root = root
                    .child(self.field(
                        &format!("{prefix}:schedule"),
                        "Cron schedule",
                        &node.data.schedule,
                        "0 9 * * 1-5",
                        window,
                        cx,
                    ))
                    .child(
                        self.work_field_choices(
                            &format!("{prefix}:schedule"),
                            &automation_choices("automationScheduleChoices")
                                .into_iter()
                                .filter(|id| id != "custom")
                                .collect::<Vec<_>>(),
                            cx,
                        ),
                    )
                    .child(self.field(
                        &format!("{prefix}:timezone"),
                        "Timezone",
                        &node.data.timezone,
                        "Europe/London",
                        window,
                        cx,
                    ));
            }
            if trigger == "github" {
                let github = node.data.extra.get("github");
                for (field, label, fallback) in [
                    ("host", "GitHub host", "github.com"),
                    ("repository", "GitHub repository", ""),
                    ("event", "GitHub event", "issue.created"),
                    ("label", "Required label (optional)", ""),
                ] {
                    root = root.child(
                        self.field(
                            &format!("{prefix}:github:{field}"),
                            label,
                            github
                                .and_then(|v| v.get(field))
                                .and_then(Value::as_str)
                                .unwrap_or(fallback),
                            fallback,
                            window,
                            cx,
                        ),
                    );
                }
                root = root.child(self.work_field_choices(
                    &format!("{prefix}:github:event"),
                    &automation_choices("githubEventChoices"),
                    cx,
                ));
                if self.value(&format!("{prefix}:github:event"), cx) != "pull_request.synchronized"
                {
                    root = root
                        .child(
                            self.field(
                                &format!("{prefix}:github:actor"),
                                "Required actor (optional)",
                                github
                                    .and_then(|v| v.get("actor"))
                                    .and_then(Value::as_str)
                                    .unwrap_or_default(),
                                "octocat",
                                window,
                                cx,
                            ),
                        )
                        .child(
                            self.field(
                                &format!("{prefix}:github:write"),
                                "Require actor write access",
                                if github
                                    .and_then(|v| v.get("requireWriteAccess"))
                                    .and_then(Value::as_bool)
                                    == Some(true)
                                {
                                    "true"
                                } else {
                                    "false"
                                },
                                "false",
                                window,
                                cx,
                            ),
                        )
                        .child(self.work_field_choices(
                            &format!("{prefix}:github:write"),
                            &["false".into(), "true".into()],
                            cx,
                        ));
                } else {
                    root=root.child("Synchronization polling cannot identify the pusher or filter by write access.");
                }
                root=root.child("Uses this computer’s GitHub CLI login and polls while its runtime is running. Existing events are not replayed when enabled.");
            }
            if trigger == "webhook" {
                root = root.child(self.automation_webhook(flow, cx));
            }
        }
        if node.data.kind == NodeKind::Task {
            root = root.child(self.text_field(
                &format!("{prefix}:objective"),
                "Objective",
                &node.data.objective,
                "Agent instructions",
                window,
                cx,
            ));
            let repositories = self
                .snapshot
                .as_ref()
                .map(|s| s.workspace.repositories.clone())
                .unwrap_or_default();
            root=root.child("Project").child(div().flex().flex_wrap().gap_2().children(repositories.into_iter().map(|repo|{
                let node_id=node.id.clone();let flow_id=flow.to_owned();let id=repo.id.clone();
                Button::new(SharedString::from(format!("{prefix}:repository:{id}"))).label(repo.name).selected(node.data.repository_id==id).on_click(cx.listener(move|this,_,_,cx|{
                    if let Some(d)=&mut this.graph && let Some(n)=d.nodes.iter_mut().find(|n|n.id==node_id){n.data.repository_id=id.clone();}
                    this.request(format!("flow-agents:{flow_id}:{id}"),"/api/agents/settings/read",json!({"scope":"environment-project","repositoryId":id,"includeAgents":true}));cx.notify();
                }))
            })));
            let agents_key = format!("flow-agents:{flow}:{}", node.data.repository_id);
            if !node.data.repository_id.is_empty() && !self.responses.contains_key(&agents_key) {
                self.request(agents_key.clone(),"/api/agents/settings/read",json!({"scope":"environment-project","repositoryId":node.data.repository_id,"includeAgents":true}));
            }
            let agents = match self
                .responses
                .get(&agents_key)
                .map(scoped_agents::effective_agents)
                .transpose()
            {
                Ok(agents) => agents.unwrap_or_default(),
                Err(error) => return root.child(error.to_string()).into_any_element(),
            };
            root = root.child("Start from a scoped agent configuration");
            for agent in agents {
                let node_id = node.id.clone();
                let harness_prefix = format!("{prefix}:harness");
                let selected = node.data.agent_id == agent.id;
                root = root.child(
                    Button::new(SharedString::from(format!("{prefix}:agent:{}", agent.id)))
                        .label(agent.name.clone())
                        .selected(selected)
                        .on_click(cx.listener(move |this, _, _, cx| {
                            match harness::freeze_agent(&agent) {
                                Ok(value) => {
                                    if let Some(d) = &mut this.graph
                                        && let Some(n) =
                                            d.nodes.iter_mut().find(|n| n.id == node_id)
                                    {
                                        n.data.agent_id = agent.id.clone();
                                        n.data.extra.remove("agentOverrides");
                                        n.data.extra.insert("harness".into(), value);
                                    }
                                    this.inputs.retain(|k, _| {
                                        !k.starts_with(&format!("{harness_prefix}:"))
                                    });
                                    this.textareas.retain(|k, _| {
                                        !k.starts_with(&format!("{harness_prefix}:"))
                                    });
                                }
                                Err(error) => this.error = Some(error.to_string()),
                            };
                            cx.notify();
                        })),
                );
            }
            let base=node.data.extra.get("harness").cloned().or_else(||self.snapshot.as_ref()?.workspace.agents.iter().find(|a|a.id==node.data.agent_id).and_then(|a|harness::freeze_agent(a).ok())).unwrap_or(json!({"provider":"codex","model":"","permission":"ask","endpoint":"","instructions":""}));
            root=root.child(Self::header("Frozen agent settings","These settings are saved with this workflow. Later changes to an agent configuration do not change its runs."))
                .child(self.harness_fields(&format!("{prefix}:harness"),&base,window,cx));
            root = root
                .child(
                    self.field(
                        &format!("{prefix}:execution"),
                        "Working directory",
                        node.data
                            .extra
                            .get("execution")
                            .and_then(Value::as_str)
                            .unwrap_or("main"),
                        "main",
                        window,
                        cx,
                    ),
                )
                .child(self.work_field_choices(
                    &format!("{prefix}:execution"),
                    &["main".into(), "worktree".into()],
                    cx,
                ))
                .child(
                    self.linked_checkout_fields(
                        &format!("{prefix}:links"),
                        node.data
                            .extra
                            .get("linkedCheckouts")
                            .cloned()
                            .unwrap_or(json!([])),
                        window,
                        cx,
                    ),
                );
        }
        let node_id = node.id.clone();
        root.child(
            Button::new("save-node-settings")
                .label("Save node settings")
                .on_click(cx.listener(move |this, _, _, cx| {
                    let result=(|| -> anyhow::Result<NodeData> {
                        let mut data=this.graph.as_ref().and_then(|d|d.nodes.iter().find(|n|n.id==node_id)).context("Node is no longer available")?.data.clone();
                        data.label=this.value(&format!("{prefix}:label"),cx);
                        anyhow::ensure!(!data.label.trim().is_empty(),"Enter a node label");
                        if data.kind==NodeKind::Trigger {
                            data.trigger=this.value(&format!("{prefix}:trigger"),cx);
                            anyhow::ensure!(matches!(data.trigger.as_str(),"manual"|"schedule"|"webhook"|"github"),"Choose a supported trigger");
                            if data.trigger=="schedule" {data.schedule=this.value(&format!("{prefix}:schedule"),cx);data.timezone=this.value(&format!("{prefix}:timezone"),cx);}
                            if data.trigger=="github" {
                                let mut github=serde_json::Map::new();
                                for field in ["host","repository","event","label"]{github.insert(field.into(),json!(this.value(&format!("{prefix}:github:{field}"),cx)));}
                                let synchronized=github.get("event")==Some(&json!("pull_request.synchronized"));
                                let write=if synchronized {false}else{let v=this.value(&format!("{prefix}:github:write"),cx);anyhow::ensure!(matches!(v.as_str(),"true"|"false"),"Choose true or false for write access");v=="true"};
                                github.insert("actor".into(),json!(if synchronized{String::new()}else{this.value(&format!("{prefix}:github:actor"),cx)}));github.insert("requireWriteAccess".into(),json!(write));
                                anyhow::ensure!(automation_choices("githubEventChoices").iter().any(|id|Some(id.as_str())==github.get("event").and_then(Value::as_str)),"Choose a supported GitHub event");
                                data.extra.insert("github".into(),Value::Object(github));
                            }
                        }
                        if data.kind==NodeKind::Task {
                            data.objective=this.text_value(&format!("{prefix}:objective"),cx);
                            let base=data.extra.get("harness").cloned().or_else(||this.snapshot.as_ref()?.workspace.agents.iter().find(|a|a.id==data.agent_id).and_then(|a|harness::freeze_agent(a).ok())).unwrap_or(json!({"provider":"codex","model":"","permission":"ask","endpoint":"","instructions":""}));
                            data.extra.insert("harness".into(),this.harness_value(&format!("{prefix}:harness"),&base,cx)?);data.extra.remove("agentOverrides");
                            let execution=this.value(&format!("{prefix}:execution"),cx);anyhow::ensure!(matches!(execution.as_str(),"main"|"worktree"),"Choose project checkout or worktree");
                            let repo=this.snapshot.as_ref().and_then(|s|s.workspace.repositories.iter().find(|r|r.id==data.repository_id)).context("Choose an available project")?;
                            anyhow::ensure!(execution!="worktree"||repo.kind.is_none(),"This project does not support worktrees");
                            data.extra.insert("execution".into(),json!(execution));data.extra.insert("linkedCheckouts".into(),this.linked_checkout_value(&format!("{prefix}:links"),cx)?);
                        }
                        Ok(data)
                    })();
                    match result {Ok(data)=>{if let Some(d)=&mut this.graph && let Some(n)=d.nodes.iter_mut().find(|n|n.id==node_id){n.data=data;}this.notice=Some("Node settings applied; save the workflow to publish them".into());},Err(error)=>this.error=Some(error.to_string())}
                    cx.notify();
                })),
        )
        .into_any_element()
    }
}

fn automation_choices(key: &str) -> Vec<String> {
    let choices: Value = serde_json::from_str(include_str!("../../assets/automation-choices.json"))
        .expect("generated protocol choices");
    choices
        .get(key)
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| item.get("id").and_then(Value::as_str).map(str::to_owned))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    #[test]
    fn removing_a_node_removes_its_edges_without_changing_other_settings() {
        let flow: crate::model::Automation =
            serde_json::from_value(json!({"id":"flow","name":"Example","nodes":[],"edges":[]}))
                .unwrap();
        let mut draft = GraphDraft::from_automation(&flow).unwrap();
        draft.add(NodeKind::Trigger);
        draft.add(NodeKind::Task);
        draft.add(NodeKind::Review);
        draft.edges.push(Edge {
            id: "a".into(),
            source: draft.nodes[0].id.clone(),
            target: draft.nodes[1].id.clone(),
        });
        draft.edges.push(Edge {
            id: "b".into(),
            source: draft.nodes[1].id.clone(),
            target: draft.nodes[2].id.clone(),
        });
        let remove = draft.nodes[1].id.clone();
        draft.remove(&remove);
        assert_eq!(draft.nodes.len(), 2);
        assert!(draft.edges.is_empty());
        assert_eq!(draft.before_nodes, json!([]));
    }
}

#[cfg(test)]
mod save_tests {
    use super::*;
    use core::prelude::v1::test;

    #[test]
    fn save_acknowledgment_preserves_edits_after_submission() {
        let flow = serde_json::from_value(json!({
            "id":"flow", "name":"Original", "enabled":false,
            "nodes":[], "edges":[]
        }))
        .expect("workflow fixture");
        let mut draft = GraphDraft::from_automation(&flow).expect("editable workflow");
        draft.add(NodeKind::Trigger);
        let submitted_nodes = json!(draft.nodes);
        draft.submitted = Some(("Saved".into(), submitted_nodes.clone(), json!([])));
        draft.add(NodeKind::Task);
        draft.acknowledge_save_for("another-flow");
        assert!(draft.submitted.is_some());
        draft.acknowledge_save_for("flow");
        assert_eq!(draft.before_name, "Saved");
        assert_eq!(draft.before_nodes, submitted_nodes);
        assert_eq!(draft.nodes.len(), 2);
        assert_ne!(json!(draft.nodes), draft.before_nodes);
        assert!(draft.submitted.is_none());
    }
}
