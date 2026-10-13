use anyhow::{Context as AnyhowContext, Result};
use gpui_kit::*;
use gpui_webview::WebView;
#[cfg(target_os = "linux")]
use raw_window_handle::RawWindowHandle;
use raw_window_handle::{HasWindowHandle, WindowHandle as RawWindow};

// GPUI exposes XCB handles on Linux; Wry's GTK backend accepts Xlib handles.
// Both contain the same X11 window ID, on the same display initialized by GTK.
struct BrowserParent<'a>(&'a Window);
impl HasWindowHandle for BrowserParent<'_> {
    fn window_handle(&self) -> Result<RawWindow<'_>, raw_window_handle::HandleError> {
        let handle = HasWindowHandle::window_handle(self.0)?;
        #[cfg(target_os = "linux")]
        let raw = match handle.as_raw() {
            RawWindowHandle::Xcb(handle) => {
                let mut xlib = raw_window_handle::XlibWindowHandle::new(handle.window.get().into());
                xlib.visual_id = handle.visual_id.map(|id| id.get().into()).unwrap_or(0);
                RawWindowHandle::Xlib(xlib)
            }
            handle => handle,
        };
        #[cfg(not(target_os = "linux"))]
        let raw = handle.as_raw();
        // SAFETY: The converted handle refers to the same live native window.
        // Its borrow remains bounded by BrowserParent's borrow of the GPUI Window.
        Ok(unsafe { RawWindow::borrow_raw(raw) })
    }
}

const ARTIFACT_POLICY: &str = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; worker-src 'none'";

pub fn artifact_html(content: &str) -> String {
    let document = format!(
        "<!doctype html><meta http-equiv=\"Content-Security-Policy\" content=\"{ARTIFACT_POLICY}\">{content}"
    );
    let escaped = document
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");
    let outer_policy = ARTIFACT_POLICY.replace("frame-src 'none'", "frame-src about:");
    format!(
        "<!doctype html><meta http-equiv=\"Content-Security-Policy\" content=\"{outer_policy}\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"><style>html,body{{margin:0;height:100%;background:white}}iframe{{border:0;width:100%;height:100%;display:block}}</style><iframe title=\"Artifact preview\" sandbox=\"allow-scripts\" allow=\"camera 'none'; microphone 'none'; geolocation 'none'; clipboard-write 'none'\" srcdoc=\"{escaped}\"></iframe>"
    )
}

pub fn open_html(title: &str, html: String, cx: &mut App) -> Result<WindowHandle<WebWindow>> {
    let title = title.to_owned();
    cx.open_window(
        WindowOptions {
            app_id: Some(crate::APP_ID.into()),
            window_bounds: Some(WindowBounds::Windowed(Bounds::centered(
                None,
                size(px(1000.), px(720.)),
                cx,
            ))),
            titlebar: Some(TitlebarOptions {
                title: Some(title.into()),
                ..Default::default()
            }),
            ..Default::default()
        },
        move |window, cx| {
            let result = wry::WebViewBuilder::new()
                .with_incognito(true)
                .with_html(html)
                .with_navigation_handler(|url| url == "about:blank" || url == "about:srcdoc")
                .with_new_window_req_handler(|_, _| wry::NewWindowResponse::Deny)
                .build_as_child(&BrowserParent(window));
            let (view, error) = match result {
                Ok(raw) => (Some(cx.new(|cx| WebView::new(raw, window, cx))), None),
                Err(error) => (None, Some(format!("Could not open the preview: {error}"))),
            };
            install_close_handler(window, cx);
            cx.new(|_| WebWindow {
                view,
                error,
                allowed_origins: Default::default(),
                on_close: None,
                closing: false,
            })
        },
    )
    .context("Could not open the preview window")
}

pub fn open_browser(
    title: &str,
    socket_url: &str,
    receive: impl Fn(&str) + 'static,
    cx: &mut App,
) -> Result<WindowHandle<WebWindow>> {
    let message = serde_json::json!({"channel":"dovo-browser","type":"connect","url":socket_url});
    let script = format!(
        "window.ReactNativeWebView={{postMessage:message=>window.ipc.postMessage(message)}};window.addEventListener('load',()=>window.postMessage({},'*'));",
        serde_json::to_string(&message)?
    );
    let html = include_str!("../assets/browser-viewer.html");
    let title = title.to_owned();
    let receive = std::rc::Rc::new(receive);
    let on_close = receive.clone();
    cx.open_window(
        WindowOptions {
            app_id: Some(crate::APP_ID.into()),
            window_bounds: Some(WindowBounds::Windowed(Bounds::centered(
                None,
                size(px(1100.), px(800.)),
                cx,
            ))),
            titlebar: Some(TitlebarOptions {
                title: Some(title.into()),
                ..Default::default()
            }),
            ..Default::default()
        },
        move |window, cx| {
            let result = wry::WebViewBuilder::new()
                .with_incognito(true)
                .with_html(html)
                .with_initialization_script(&script)
                .with_navigation_handler(|url| url == "about:blank")
                .with_new_window_req_handler(|_, _| wry::NewWindowResponse::Deny)
                .with_ipc_handler(move |request| {
                    if let Ok(value) = serde_json::from_str::<serde_json::Value>(request.body())
                        && value.get("channel").and_then(serde_json::Value::as_str)
                            == Some("dovo-browser")
                        && let Some(action @ ("reconnect" | "close")) =
                            value.get("type").and_then(serde_json::Value::as_str)
                    {
                        receive(action);
                    }
                })
                .build_as_child(&BrowserParent(window));
            let (view, error) = match result {
                Ok(raw) => (Some(cx.new(|cx| WebView::new(raw, window, cx))), None),
                Err(error) => (None, Some(format!("Could not open the browser: {error}"))),
            };
            install_close_handler(window, cx);
            cx.new(|_| WebWindow {
                view,
                error,
                allowed_origins: Default::default(),
                on_close: Some(Box::new(move || on_close("close"))),
                closing: false,
            })
        },
    )
    .context("Could not open the browser preview window")
}

pub struct WebWindow {
    pub view: Option<Entity<WebView>>,
    error: Option<String>,
    on_close: Option<Box<dyn Fn()>>,
    closing: bool,
    pub allowed_origins: std::rc::Rc<std::cell::RefCell<std::collections::HashSet<String>>>,
}
// GPUI's rendered elements retain native view handles until the next frame.
// Render without the child before destroying its parent (including OS close requests).
fn install_close_handler(window: &mut Window, cx: &App) {
    window.on_window_should_close(cx, |window, cx| {
        if let Some(Some(root)) = window.root::<WebWindow>() {
            root.update(cx, |view, cx| view.close(window, cx));
            false
        } else {
            true
        }
    });
}
impl WebWindow {
    pub fn close(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.closing {
            return;
        }
        self.closing = true;
        if let Some(view) = self.view.take() {
            view.update(cx, |view, _| view.hide());
        }
        let on_close = self.on_close.take();
        cx.notify();
        window.on_next_frame(move |window, _| {
            window.on_next_frame(move |window, _| {
                // GTK uses Xlib and GPUI uses a separate XCB connection. Settle
                // child destruction on GTK's connection before XCB destroys the parent.
                #[cfg(target_os = "linux")]
                {
                    if let Some(display) = gtk::gdk::Display::default() {
                        display.sync();
                    }
                }
                window.remove_window();
                if let Some(close) = on_close {
                    close();
                }
            });
        });
    }
}
impl Render for WebWindow {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        div()
            .size_full()
            .bg(rgb(0x171a20))
            .text_color(rgb(0xe4e7ec))
            .children(self.view.clone())
            .children(self.error.clone().map(|error| div().p_6().child(error)))
    }
}

pub fn open_mcp(
    title: &str,
    app: serde_json::Value,
    nonce: String,
    receive: impl Fn(serde_json::Value) + 'static,
    close: impl Fn() + 'static,
    cx: &mut App,
) -> Result<WindowHandle<WebWindow>> {
    let allowed_origins: std::rc::Rc<std::cell::RefCell<std::collections::HashSet<String>>> =
        Default::default();
    if let Some(domains) = app
        .pointer("/resource/_meta/ui/csp/frameDomains")
        .and_then(serde_json::Value::as_array)
    {
        for domain in domains.iter().filter_map(serde_json::Value::as_str) {
            if let Ok(url) = url::Url::parse(domain)
                && matches!(url.scheme(), "http" | "https")
                && url.username().is_empty()
                && url.password().is_none()
            {
                allowed_origins
                    .borrow_mut()
                    .insert(url.origin().ascii_serialization());
            }
        }
    }
    let load = serde_json::json!({"type":"load","app":app,"nonce":nonce,"theme":"dark"});
    // Guests remain in opaque sandbox frames. Only the trusted top-level host holds
    // the per-view nonce and can forward messages to native IPC.
    let script = format!(
        r#"const nativeNonce={};window.ReactNativeWebView={{postMessage:raw=>{{const value=JSON.parse(raw);if(value.type==='ready'){{window.postMessage({},'*');return;}}if(value.nonce===nativeNonce)window.ipc.postMessage(raw);}}}};"#,
        serde_json::to_string(&nonce)?,
        serde_json::to_string(&load)?.replace('<', "\\u003c")
    );
    let html = include_str!("../assets/mcp-host.html").replacen(
        "<script>",
        &format!("<script>{script}</script><script>"),
        1,
    );
    let title = title.to_owned();
    cx.open_window(
        WindowOptions {
            app_id: Some(crate::APP_ID.into()),
            window_bounds: Some(WindowBounds::Windowed(Bounds::centered(
                None,
                size(px(1000.), px(720.)),
                cx,
            ))),
            titlebar: Some(TitlebarOptions {
                title: Some(title.into()),
                ..Default::default()
            }),
            ..Default::default()
        },
        move |window, cx| {
            let expected = nonce;
            let navigation_origins = allowed_origins.clone();
            let raw = wry::WebViewBuilder::new()
                .with_incognito(true)
                .with_html(html)
                .with_navigation_handler(move |raw| {
                    matches!(raw.as_str(), "about:blank" | "about:srcdoc")
                        || url::Url::parse(&raw).is_ok_and(|url| {
                            url.scheme() == "blob"
                                || navigation_origins
                                    .borrow()
                                    .contains(&url.origin().ascii_serialization())
                        })
                })
                .with_new_window_req_handler(|_, _| wry::NewWindowResponse::Deny)
                .with_ipc_handler(move |request| {
                    if request.body().len() > 256 * 1024 {
                        return;
                    }
                    if let Ok(value) = serde_json::from_str::<serde_json::Value>(request.body())
                        && value.get("nonce").and_then(serde_json::Value::as_str)
                            == Some(expected.as_str())
                    {
                        receive(value);
                    }
                })
                .build_as_child(&BrowserParent(window));
            let (view, error) = match raw {
                Ok(raw) => (Some(cx.new(|cx| WebView::new(raw, window, cx))), None),
                Err(error) => (None, Some(format!("Could not open MCP app: {error}"))),
            };
            install_close_handler(window, cx);
            cx.new(|_| WebWindow {
                view,
                error,
                allowed_origins,
                on_close: Some(Box::new(close)),
                closing: false,
            })
        },
    )
    .context("Could not open the MCP app window")
}

impl Drop for WebWindow {
    fn drop(&mut self) {
        self.view.take();
        if let Some(close) = self.on_close.take() {
            close();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use core::prelude::v1::test;
    #[test]
    fn artifacts_are_isolated_without_credentials_or_network() {
        let html = artifact_html("<script>fetch('http://host:8787')</script><h1>Preview</h1>");
        assert!(html.contains("sandbox=\"allow-scripts\""));
        assert!(!html.contains("allow-same-origin"));
        assert!(html.contains("connect-src 'none'"));
        assert!(html.contains("&lt;script&gt;"));
        assert!(html.contains("form-action 'none'"));
    }
}
