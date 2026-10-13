use crate::{connection::RuntimeClient, service::Event};
use anyhow::{Result, ensure};
use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use tokio::sync::mpsc;
use tokio_tungstenite::{connect_async, tungstenite::Message};

pub struct Frame {
    pub sequence: u32,
    pub width: u32,
    pub height: u32,
    pub bytes: Vec<u8>,
}
pub fn decode(packet: &[u8]) -> Result<Frame> {
    ensure!(
        packet.len() > 12 && packet.len() <= 16 * 1024 * 1024,
        "Invalid device frame size"
    );
    let number = |offset| {
        u32::from_be_bytes([
            packet[offset],
            packet[offset + 1],
            packet[offset + 2],
            packet[offset + 3],
        ])
    };
    let sequence = number(0);
    let width = number(4);
    let height = number(8);
    ensure!(
        sequence > 0 && (240..=1920).contains(&width) && (240..=1920).contains(&height),
        "Invalid device frame dimensions"
    );
    Ok(Frame {
        sequence,
        width,
        height,
        bytes: packet[12..].to_vec(),
    })
}
pub async fn stream(
    client: RuntimeClient,
    generation: u64,
    id: String,
    ticket: String,
    mut input: mpsc::Receiver<Value>,
    events: async_channel::Sender<Event>,
) -> Result<()> {
    let url = client.websocket_url("/ws/simulator", &ticket)?;
    let (mut socket, _) = connect_async(url.as_str()).await?;
    loop {
        tokio::select! {
            input=input.recv()=>match input{Some(input)=>socket.send(Message::Text(input.to_string().into())).await?,None=>return Ok(())},
            message=socket.next()=>match message {
                Some(Ok(Message::Binary(packet)))=>{
                    let frame=decode(&packet)?;

                    events.send(Event::DeviceFrame{generation,id:id.clone(),frame}).await?;

                }
                Some(Ok(Message::Text(text)))=>{
                    let value:Value=serde_json::from_str(&text)?;
                    if value.get("type").and_then(Value::as_str)==Some("error") {
                        anyhow::bail!("{}",value.get("message").and_then(Value::as_str).unwrap_or("Device preview failed"));
                    }
                }
                Some(Ok(Message::Ping(payload)))=>socket.send(Message::Pong(payload)).await?,
                Some(Ok(Message::Close(_)))|None=>return Ok(()),
                Some(Err(error))=>return Err(error.into()),
                _=>{}
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::decode;
    #[test]
    fn device_frames_check_bounds_and_preserve_image_bytes() {
        let mut packet = vec![];
        for number in [1u32, 390, 844] {
            packet.extend_from_slice(&number.to_be_bytes());
        }
        packet.extend_from_slice(b"jpeg");
        let frame = decode(&packet).unwrap();
        assert_eq!((frame.width, frame.height), (390, 844));
        assert_eq!(frame.bytes, b"jpeg");
        packet[4..8].copy_from_slice(&0u32.to_be_bytes());
        assert!(decode(&packet).is_err());
        assert!(decode(&[0; 12]).is_err());
    }
}
