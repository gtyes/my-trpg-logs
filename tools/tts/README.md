# TRPG 日志语音生成说明

语音生成分为两部分：日志编辑器整理并导出待生成任务；本地 Python 脚本调用 Google Cloud Text-to-Speech 生成 MP3，再按需上传到 Cloudflare R2。API Key 和 R2 密钥只由本机浏览器或本地环境变量读取，不会写入日志 JSON 或生成任务文件。

## 一、准备 Google TTS

1. 在 Google Cloud 项目中启用 Cloud Text-to-Speech API，并创建 API Key。请先确认项目的结算、配额和当前音色价格；编辑器中的月度预算只是本地上限，不代表 Google 免费额度。
2. 用 Edge 打开仓库中的 `data\日志编辑器.html`，点击“编辑本地日志”并选择要处理的 JSON。
3. 找到“角色语音生成”面板，输入 API Key，点击“保存 Key”。Key 只保存在当前浏览器的本地存储中；不要在公用电脑或共享浏览器配置中使用。
4. 点击“获取语音列表”，从列表中为角色选择中文音色。新角色默认关闭语音，只有选择音色并勾选启用的角色会参与扫描。
5. 点击“试听”检查声音。若音色不支持音调参数，试听会自动去掉该参数重试，并关闭该角色的音调滑块；之后扫描导出的任务会保留这个设置。

## 二、配置与扫描

- “全部”统计该角色的非章节消息及文本字符数；“减去闲聊”是从总数中扣除闲聊及项目现有分类器认定的其他闲聊类频道后的数量。
- “闲聊也生成”默认关闭。开启后只会纳入已配置并启用语音的角色的闲聊消息。
- 角色语速、音调、音量和音色都会影响哈希。若音色不支持音调，该音色不会发送音调参数。
- 扫描会跳过章节、空文本、CoC 检定指令和单独的骰点公式。相同文本和相同语音设置只产生一个任务；移动或删除消息不改变哈希。
- 扫描后检查参与角色、去重任务数、待生成字符数、预估时长/大小和月度预算。超过预算时不能导出任务。
- 点击“导出生成任务”，浏览器会下载一个任务 JSON。把下载的文件移动到仓库的 `.tts-output` 文件夹，并重命名为 `tasks.json`，供下面的命令读取。生成任务不包含 API Key。

## 三、本地生成和上传 R2

使用 Python 3.10 或更新版本。将 PowerShell 当前目录设为仓库根目录，然后安装脚本依赖：

```powershell
python -m pip install -r tools\tts\requirements.txt
```

配置 Google API Key。将引号中的示例文字替换成自己的密钥，不要提交到 Git：

```powershell
$env:GOOGLE_TTS_API_KEY = "你的 Google API Key"
```

要上传到 Cloudflare R2，还需在 Cloudflare 创建私有访问密钥并准备存储桶。设置以下环境变量：

```powershell
$env:R2_ACCOUNT_ID = "你的 Cloudflare 账户 ID"
$env:R2_ACCESS_KEY_ID = "你的 R2 访问密钥 ID"
$env:R2_SECRET_ACCESS_KEY = "你的 R2 私有访问密钥"
$env:R2_BUCKET_NAME = "trpg-audio"
$env:R2_PUBLIC_BASE_URL = "https://你的公开音频域名"
```

`R2_PUBLIC_BASE_URL` 可以使用 Cloudflare R2 开发子域或绑定的自定义域名。需确保此地址可以公开读取音频；不要把 R2 私有访问密钥写入项目文件。

先运行预检。预检只读取任务和本地清单，不调用 Google 或 R2：

```powershell
python tools\tts\generate.py .tts-output\tasks.json --dry-run
```

预检通过后，运行生成和 R2 上传：

```powershell
python tools\tts\generate.py .tts-output\tasks.json
```

若暂时只想在本机生成、不上传 R2，可运行：

```powershell
python tools\tts\generate.py .tts-output\tasks.json --no-upload
```

本地生成仍会调用 Google 并消耗相应配额。`--dry-run` 不会调用任何外部 API。

脚本会将音频保存在 `.tts-output\audio\<哈希前两位>\<完整哈希>.mp3`，并在 `.tts-output\manifest.json` 中保存语音清单。上传模式会将音频和清单上传到 R2；音频使用长期缓存，清单使用不缓存策略。已有清单中的音频会跳过，任务中断后可重新运行以继续处理。

## 四、导入结果并发布

1. 回到日志编辑器，点击“导入语音清单”，选择 `.tts-output\manifest.json`。
2. 编辑器会按哈希将音频地址回填到匹配的消息，并保存 `ttsHash`、`ttsAudioUrl`、`ttsVoiceName` 和 `ttsCharCount`。
3. 点击“保存修改”写回导入的 JSON，或点击“导出修改后的 JSON”下载副本。
4. 将更新后的 JSON 发布到网站。`viewer.html` 会在有音频地址的消息上显示播放器；音频采用 `preload="none"`，不会打开页面就批量下载。

## 五、额度和长文本

编辑器默认设置每月一百万字符的本地预算。扫描时会把本地记录的试听用量、清单记录的本月已生成用量，以及本次去重后的待生成字符数相加；超过预算会阻止导出。也可以通过 `TTS_MONTHLY_CHAR_LIMIT` 给本地脚本增加更严格的上限：

```powershell
$env:TTS_MONTHLY_CHAR_LIMIT = "50000"
```

免费额度、音色计费方式和价格会因 Google Cloud 账户及音色系列而不同，请以 Google Cloud 当前定价与配额页面为准。

超过单次请求字节上限的长文本会优先按句子和换行切分，再按 Unicode 字符切分。每段分别生成，多个 MP3 片段由 FFmpeg 合并；如需要处理长文本，请安装 FFmpeg 并确保 `ffmpeg` 命令可在 PowerShell 中运行。

## 六、哈希与文件约定

哈希由规范化文本、语言、音色、语速、音调（音色支持时）、音量、MP3 格式和脚本引擎版本计算，不包含角色名、消息 ID、序号或时间。因此相同文本与相同音色设置共用音频；消息顺序变化不会触发重新生成。

音频按内容哈希存放，删除消息不会自动删除音频。语音清单会保留已生成记录，建议定期备份 `.tts-output\manifest.json`。API Key、R2 密钥和本地产物目录不会加入日志 JSON。

运行脚本的单元测试：

```powershell
python -m unittest discover -s tools\tts -p "test_*.py"
```
