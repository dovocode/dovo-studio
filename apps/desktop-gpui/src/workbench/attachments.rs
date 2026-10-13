use super::*;
use base64::{Engine, engine::general_purpose::STANDARD};

impl Workbench {
    pub(super) fn pick_attachment(&mut self, cx: &mut Context<Self>) {
        let Some(task) = self.task() else {
            return;
        };
        if task.draft_attachments.len() >= 5 {
            self.error = Some("A message can contain up to five attachments".into());
            return;
        }
        let task_id = task.id.clone();
        self.pending.insert(format!("attachment-pick:{task_id}"));
        let generation = self.generation;
        let picker = cx.prompt_for_paths(PathPromptOptions {
            files: true,
            directories: false,
            multiple: false,
            prompt: Some("Attach a file (up to 4 MB)".into()),
        });
        cx.spawn(async move|this,cx| {
            let result=async {
                let paths=picker.await??;
                let Some(path)=paths.and_then(|paths|paths.into_iter().next()) else{return Ok(None);};
                let file=cx.background_executor().spawn(async move {
                    anyhow::ensure!(std::fs::metadata(&path)?.len()<=4*1024*1024,"Attachments must be 4 MB or smaller");
                    let name=path.file_name().and_then(|name|name.to_str()).ok_or_else(||anyhow::anyhow!("The filename is not valid UTF-8"))?.to_owned();
                    anyhow::ensure!(name.chars().count()<=250,"The attachment filename is too long");
                    let bytes=std::fs::read(path)?;
                    anyhow::ensure!(bytes.len()<=4*1024*1024,"Attachments must be 4 MB or smaller");
                    Ok::<_,anyhow::Error>((name,STANDARD.encode(bytes)))
                }).await?;
                Ok::<_,anyhow::Error>(Some(file))
            }.await;
            let _=this.update(cx,|this,cx| {
                if this.generation!=generation{return;}
                this.pending.remove(&format!("attachment-pick:{task_id}"));
                match result {
                    Ok(Some((name,data)))=>this.request(format!("attachment-upload:{task_id}"),"/api/attachments/upload",json!({"taskId":task_id,"id":uuid::Uuid::new_v4().to_string(),"name":name,"data":data})),
                    Ok(None)=>{},Err(error)=>this.error=Some(error.to_string()),
                }
                cx.notify();
            });
        }).detach();
    }
}

impl Workbench {
    pub(super) fn save_attachment_result(
        &mut self,
        value: &Value,
        cx: &mut Context<Self>,
    ) -> anyhow::Result<()> {
        #[derive(serde::Deserialize)]
        struct Download {
            attachment: crate::model::Attachment,
            data: String,
        }
        let download: Download = serde_json::from_value(value.clone())?;
        anyhow::ensure!(
            download.data.len() <= 4 * 1024 * 1024 * 4 / 3 + 4,
            "Attachment exceeds the four megabyte limit"
        );
        let bytes = STANDARD.decode(download.data)?;
        anyhow::ensure!(
            bytes.len() <= 4 * 1024 * 1024 && bytes.len() as u64 == download.attachment.size,
            "Attachment size does not match its metadata"
        );
        let base = directories::UserDirs::new()
            .map(|dirs| dirs.download_dir().unwrap_or(dirs.home_dir()).to_owned())
            .ok_or_else(|| anyhow::anyhow!("Cannot find the downloads directory"))?;
        let name = download.attachment.name;
        let suggested = std::path::Path::new(&name)
            .file_name()
            .and_then(|name| name.to_str())
            .ok_or_else(|| anyhow::anyhow!("Invalid attachment filename"))?;
        let picker = cx.prompt_for_new_path(&base, Some(suggested));
        let generation = self.generation;
        cx.spawn(async move |this, cx| {
            let result = async {
                let Some(path) = picker.await?? else {
                    return Ok(false);
                };
                this.update(cx, |this, _| -> anyhow::Result<()> {
                    anyhow::ensure!(
                        this.generation == generation,
                        "The runtime connection changed"
                    );
                    Ok(())
                })??;
                cx.background_executor()
                    .spawn(async move { std::fs::write(path, bytes) })
                    .await?;
                Ok::<_, anyhow::Error>(true)
            }
            .await;
            let _ = this.update(cx, |this, cx| {
                match result {
                    Ok(true) => this.notice = Some(format!("Saved {name}")),
                    Ok(false) => {}
                    Err(error) => this.error = Some(error.to_string()),
                };
                cx.notify();
            });
        })
        .detach();
        Ok(())
    }
}
