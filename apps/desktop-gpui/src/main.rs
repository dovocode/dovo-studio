mod connection;
mod device_preview;
mod drafts;
mod fleet;
#[cfg(test)]
mod integration_tests;
mod local_runtime;
mod mcp_downloads;
mod mcp_tools;
mod model;
mod outbox;
mod prompts;
mod service;
mod storage;
mod sync;
mod task_family;
mod web_content;
mod workbench;

use anyhow::{Context, Result};
use gpui_kit::*;
use storage::Storage;
use workbench::{FocusComposer, NewTask, Quit, Search, SendMessage, ToggleTaskSidebar, Workbench};

const APP_ID: &str = "dev.dovo.studio.gpui";

fn main() {
    if let Err(error) = run() {
        eprintln!("Dovo Studio could not start: {error:#}");
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    let storage = Storage::new()?;
    let mut initial = Vec::new();
    let mut preview = None;
    let mut arguments = std::env::args().skip(1);
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--connection-file" => {
                let path = arguments
                    .next()
                    .context("--connection-file requires a path")?;
                let bytes =
                    std::fs::read(path).context("Could not read the runtime connection file")?;
                initial.push(
                    serde_json::from_slice::<connection::Connection>(&bytes)
                        .context("Invalid runtime connection file")?,
                );
            }
            "--preview-html" => {
                let path = arguments.next().context("--preview-html requires a path")?;
                preview =
                    Some(std::fs::read_to_string(path).context("Could not read preview HTML")?);
            }
            "--help" | "-h" => {
                println!(
                    "Dovo Studio GPUI\n\nUsage: dovo-desktop-gpui [--connection-file PATH]...\n\nPair remote computers in Computers, or attach to existing runtimes using their runtime-connection.json files. Repeat --connection-file to load multiple servers for this session; the first is selected."
                );
                return Ok(());
            }
            _ => anyhow::bail!("Unknown argument: {argument}"),
        }
    }
    #[cfg(target_os = "linux")]
    gtk::init().context("Could not initialize the embedded browser")?;
    #[cfg(target_os = "linux")]
    let application = gpui_kit::platform::linux(WindowingModes::X11);
    #[cfg(not(target_os = "linux"))]
    let application = gpui_kit::application();
    application
        .with_assets(gpui_kit::assets::AllAssets)
        .run(move |cx| {
            cx.set_app_identity(APP_ID, "Dovo Studio GPUI");
            if let Err(error) = workbench::appearance::load_fonts(cx) {
                eprintln!("Could not load the bundled UI fonts: {error:#}");
                cx.quit();
                return;
            }
            gpui_kit::init(cx);
            workbench::init(cx);
            cx.set_prompt_builder(prompts::render_prompt);
            #[cfg(target_os = "linux")]
            cx.spawn(async move |cx| {
                loop {
                    cx.background_executor()
                        .timer(std::time::Duration::from_millis(16))
                        .await;
                    // Wry's GTK children share the UI thread with GPUI's X11 event loop.
                    let mut handled = 0;
                    while gtk::events_pending() && handled < 100 {
                        gtk::main_iteration_do(false);
                        handled += 1;
                    }
                }
            })
            .detach();
            cx.on_action(|_: &Quit, cx| cx.quit());
            cx.bind_keys([
                KeyBinding::new("secondary-q", Quit, None),
                KeyBinding::new("secondary-enter", SendMessage, Some("DovoWorkbench")),
                KeyBinding::new("secondary-enter", SendMessage, Some("DovoComposer > Input")),
                KeyBinding::new("secondary-n", NewTask, Some("DovoWorkbench")),
                KeyBinding::new("secondary-k", Search, Some("DovoWorkbench")),
                KeyBinding::new("secondary-b", ToggleTaskSidebar, Some("DovoWorkbench")),
                KeyBinding::new(
                    "secondary-b",
                    ToggleTaskSidebar,
                    Some("DovoComposer > Input"),
                ),
                KeyBinding::new("secondary-l", FocusComposer, Some("DovoWorkbench")),
            ]);
            if let Some(html) = preview
                && let Err(error) = web_content::open_html(
                    "Dovo · Artifact preview",
                    web_content::artifact_html(&html),
                    cx,
                )
            {
                eprintln!("Could not preview HTML: {error}");
            }
            let options = WindowOptions {
                app_id: Some(APP_ID.into()),
                window_bounds: Some(WindowBounds::Windowed(Bounds::centered(
                    None,
                    size(px(1180.), px(760.)),
                    cx,
                ))),
                window_min_size: Some(size(px(840.), px(560.))),
                titlebar: Some(TitlebarOptions {
                    title: Some("Dovo Studio GPUI".into()),
                    ..gpui_kit::component::TitleBar::title_bar_options()
                }),
                ..gpui_kit::component::TitleBar::window_options()
            };
            match gpui_kit::open_window(options, cx, move |window, cx| {
                cx.new(|cx| {
                    Workbench::new(storage, initial, window, cx)
                        .expect("Could not initialize the Dovo workbench")
                })
            }) {
                Ok(_) => cx.activate(true),
                Err(error) => {
                    eprintln!("Could not open the Dovo Studio window: {error}");
                    cx.quit();
                }
            }
        });
    Ok(())
}
