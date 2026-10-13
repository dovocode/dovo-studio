use crate::connection::RuntimeClient;
use anyhow::{Context, Result, ensure};
use base64::{Engine, engine::general_purpose::STANDARD};
use serde_json::{Value, json};

pub struct Export {
    pub name: String,
    pub bytes: Vec<u8>,
}
pub async fn resolve(
    client: &RuntimeClient,
    task: &str,
    id: &str,
    nonce: &str,
    request: &str,
    params: Value,
) -> Result<Vec<Export>> {
    let contents = params
        .get("contents")
        .and_then(Value::as_array)
        .context("Missing app export contents")?;
    ensure!(
        (1..=8).contains(&contents.len()),
        "An app can export one to eight files"
    );
    let mut resources = vec![];
    for (index, item) in contents.iter().enumerate() {
        match item.get("type").and_then(Value::as_str) {
            Some("resource") => resources.push(
                item.get("resource")
                    .context("Missing exported resource")?
                    .clone(),
            ),
            Some("resource_link") => {
                let uri = item
                    .get("uri")
                    .and_then(Value::as_str)
                    .context("Missing exported resource URI")?;
                let result:Value=client.post("/api/mcp-apps/rpc",&json!({"taskId":task,"id":id,"requestId":format!("{nonce}_{request}_read_{index}"),"method":"resources/read","params":{"uri":uri}})).await?;
                let values = result
                    .get("result")
                    .and_then(|result| result.get("contents"))
                    .and_then(Value::as_array)
                    .context("The exported resource is unavailable")?;
                resources.extend(values.iter().cloned());
            }
            _ => anyhow::bail!("Unsupported app export"),
        }
        ensure!(resources.len() <= 8, "Too many app exports");
    }
    decode(&resources)
}
fn decode(resources: &[Value]) -> Result<Vec<Export>> {
    let mut size = 0usize;
    resources
        .iter()
        .map(|resource| {
            let text = resource.get("text").and_then(Value::as_str);
            let blob = resource.get("blob").and_then(Value::as_str);
            let content = text.or(blob).context("The exported file is empty")?;
            size = size
                .checked_add(content.len())
                .context("Export size overflow")?;
            ensure!(
                size <= 2 * 1024 * 1024,
                "App exports exceed the two megabyte limit"
            );
            let bytes = if text.is_some() {
                content.as_bytes().to_vec()
            } else {
                STANDARD
                    .decode(content)
                    .context("Invalid exported file encoding")?
            };
            let raw = resource
                .get("uri")
                .and_then(Value::as_str)
                .and_then(|uri| uri.rsplit('/').next())
                .unwrap_or("export.txt")
                .split(['?', '#'])
                .next()
                .unwrap_or_default();
            let name: String = raw
                .chars()
                .map(|c| {
                    if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
                        c
                    } else {
                        '_'
                    }
                })
                .collect::<String>()
                .trim_start_matches('.')
                .chars()
                .take(120)
                .collect();
            Ok(Export {
                name: if name.is_empty() {
                    "export.txt".into()
                } else {
                    name
                },
                bytes,
            })
        })
        .collect()
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exports_preserve_binary_content_and_sanitize_names() {
        let files = decode(&[json!({"uri":"file:///../../.hidden?x","blob":"AAH/"})]).unwrap();
        assert_eq!(files[0].name, "hidden");
        assert_eq!(files[0].bytes, [0, 1, 255]);
        assert!(decode(&[json!({"blob":"invalid!"})]).is_err());
        assert!(decode(&[json!({"text":"x".repeat(2*1024*1024+1)})]).is_err());
    }
}
