mod media;

use idevice::{
    IdeviceService, RsdService,
    core_device::hid::{
        ButtonState, IndigoHidClient, KeyboardUsage, TOUCHSCREEN_STATE_CONTACT,
        TOUCHSCREEN_STATE_RELEASE, UniversalHidServiceClient,
    },
    core_device::{HevcDepacketizer, RtpPacket},
    core_device_proxy::CoreDeviceProxy,
    rsd::RsdHandshake,
    usbmuxd::{UsbmuxdAddr, UsbmuxdConnection},
};
use serde::Deserialize;
use serde_json::json;
use std::{error::Error, time::Duration};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

type Failure = Box<dyn Error + Send + Sync>;
#[derive(Deserialize)]
struct Input {
    id: u32,
    #[serde(flatten)]
    command: Command,
}
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase", deny_unknown_fields)]
enum Command {
    Pointer { phase: Phase, x: u16, y: u16 },
    Key { codes: Vec<u16> },
    Button { code: u64 },
    Release,
    Pause,
    Resume,
}
#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum Phase {
    Down,
    Move,
    Up,
}
fn event(value: serde_json::Value) {
    eprintln!("{value}");
}

#[tokio::main]
async fn main() {
    if let Err(error) = run().await {
        event(json!({"type":"error","message":error.to_string()}));
        std::process::exit(1);
    }
}
async fn run() -> Result<(), Failure> {
    let udid = std::env::args()
        .nth(1)
        .ok_or("Missing physical device identifier")?;
    let mut mux = UsbmuxdConnection::default().await?;
    let device = mux.get_device(&udid).await?;
    let provider = device.to_provider(UsbmuxdAddr::from_env_var()?, "Dovo Studio");
    let proxy = CoreDeviceProxy::connect(&provider).await?;
    let port = proxy.tunnel_info().server_rsd_port;
    let mut adapter = proxy.create_software_tunnel()?.to_async_handle();
    let socket = adapter.connect(port).await?;
    let mut handshake = RsdHandshake::new(socket).await?;
    let mut media = media::start_screen_media_stream(&mut adapter, &mut handshake, 1).await?;
    let mut touch = UniversalHidServiceClient::connect_rsd(&mut adapter, &mut handshake).await?;
    let mut buttons = IndigoHidClient::connect_rsd(&mut adapter, &mut handshake).await?;
    let mut keyboard = touch.create_main_keyboard().await?;
    // iOS authenticates HID reports against the active display session.
    tokio::time::sleep(Duration::from_millis(300)).await;
    event(json!({"type":"ready","device":udid}));

    let (video_tx, mut video_rx) = tokio::sync::mpsc::channel::<Vec<u8>>(4);
    let writer = tokio::spawn(async move {
        let mut output = tokio::io::stdout();
        while let Some(data) = video_rx.recv().await {
            output.write_all(&data).await?;
            output.flush().await?;
        }
        Ok::<(), std::io::Error>(())
    });
    let mut video = tokio::spawn(async move {
        let mut decoder = HevcDepacketizer::new();
        loop {
            let packet = media.video_udp.recv().await?;
            if let Some(rtp) = RtpPacket::parse(&packet.data) {
                decoder.push(rtp.sequence_number, rtp.timestamp, rtp.payload);
                let data = decoder.take_output();
                if !data.is_empty() && video_tx.send(data).await.is_err() {
                    break;
                }
            }
        }
        Ok::<(), Failure>(())
    });
    let audio = tokio::spawn(async move { while media.audio_udp.recv().await.is_ok() {} });
    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    let mut point = None;
    let mut pressed = Vec::<u16>::new();
    let result: Result<(), Failure> = async {
        loop {
            let line = tokio::select! {
                line = lines.next_line() => line?,
                ended = &mut video => {
                    ended??;
                    return Err("Device video stream ended".into());
                }
            };
            let Some(line) = line else { break };

            if line.len() > 65536 {
                return Err("Device input exceeds limit".into());
            }
            let input: Input = serde_json::from_str(&line)?;
            match input.command {
                Command::Pointer { phase, x, y } => {
                    // Hover is not a touchscreen contact, but must still be acknowledged.
                    if !matches!(phase, Phase::Move) || point.is_some() {
                        let state = if matches!(phase, Phase::Up) {
                            TOUCHSCREEN_STATE_RELEASE
                        } else {
                            TOUCHSCREEN_STATE_CONTACT
                        };
                        touch.send_touchscreen(state, x, y, None).await?;
                        point = if matches!(phase, Phase::Up) {
                            None
                        } else {
                            Some((x, y))
                        };
                    }
                }
                Command::Key { codes } => {
                    if codes.is_empty() || codes.len() > 8 {
                        return Err("Invalid key combination".into());
                    }
                    if codes.iter().any(|code| *code == 0 || *code > 0xE7) {
                        return Err("Invalid keyboard usage".into());
                    }
                    for code in codes {
                        pressed.push(code);
                        touch
                            .main_keyboard_key_down(&mut keyboard, KeyboardUsage::new(code)?)
                            .await?;
                        tokio::time::sleep(Duration::from_millis(12)).await;
                    }
                    while let Some(code) = pressed.last().copied() {
                        touch
                            .main_keyboard_key_up(&mut keyboard, KeyboardUsage::new(code)?)
                            .await?;
                        pressed.pop();
                    }
                }
                Command::Button { code } => {
                    if ![0x40, 0x30, 0xE9, 0xEA, 0xE2].contains(&code) {
                        return Err("Unsupported hardware button".into());
                    }
                    buttons.send_button(0x0C, code, ButtonState::Down).await?;
                    tokio::time::sleep(Duration::from_millis(80)).await;
                    buttons.send_button(0x0C, code, ButtonState::Up).await?;
                }
                Command::Release | Command::Pause => {
                    if let Some((x, y)) = point.take() {
                        touch
                            .send_touchscreen(TOUCHSCREEN_STATE_RELEASE, x, y, None)
                            .await?;
                    }
                    touch.reset_main_keyboard(&mut keyboard).await?;
                }
                Command::Resume => {}
            }
            event(json!({"type":"ack","id":input.id}));
        }
        Ok(())
    }
    .await;
    // Release input even when the client disconnects or sends invalid input.
    let cleanup = async {
        if let Some((x, y)) = point {
            touch
                .send_touchscreen(TOUCHSCREEN_STATE_RELEASE, x, y, None)
                .await?;
        }
        touch.remove_main_keyboard(&mut keyboard).await?;
        media.client.stop_media_stream().await?;
        Ok::<(), Failure>(())
    };
    match tokio::time::timeout(Duration::from_secs(3), cleanup).await {
        Ok(Ok(())) => {}
        Ok(Err(error)) => {
            event(json!({"type":"error","message":format!("Device cleanup failed: {error}")}))
        }
        Err(error) => {
            event(json!({"type":"error","message":format!("Device cleanup timed out: {error}")}))
        }
    }
    video.abort();
    audio.abort();
    writer.abort();
    result
}
