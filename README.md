# TRPG 跑团日志

这是一个用于编辑和展示 TRPG 跑团日志的静态网页项目。

- `data\日志编辑器.html`：导入并编辑本地日志 JSON。
- `viewer.html`：读取日志 JSON 并展示日志。
- `tools\tts\README.md`：角色语音配置、语音生成、R2 上传和清单回填的完整说明。

## 生成消息语音

先在日志编辑器配置并试听角色音色，再扫描和导出生成任务；使用本地 Python 脚本调用 Google TTS 生成音频并上传 Cloudflare R2；最后把生成清单导入编辑器，将音频地址写回日志 JSON。

详细步骤、PowerShell 命令和额度说明见[角色语音生成说明](tools/tts/README.md)。
