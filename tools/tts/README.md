# TRPG voice generation

The editor prepares deduplicated tasks. This local script calls Google Cloud
Text-to-Speech, stores MP3 files by content hash, updates a manifest, and can
upload audio and the manifest to Cloudflare R2.

## Editor workflow

1. Open `data/日志编辑器.html` in Edge and import a log JSON.
2. In **角色语音生成**, enter a Google Cloud Text-to-Speech API key and save it.
   The key is kept in this browser's local storage; it is not included in the
   log JSON, role configuration export, or task export. Do not enter it in a
   shared/public browser profile.
3. Fetch the Chinese voice list, select a voice and tune each role. New roles
   start disabled. Role settings, the chatter toggle, and the monthly character
   budget are stored in the log JSON under `ttsConfig`.
4. Scan the log and review the deduplicated task count, character estimate,
   role/channel summary, and budget projection. Export the generation task JSON
   and save/move it to `.tts-output\tasks.json`.
5. Run the local generator below. It writes `manifest.json` and uploads it to
   R2 together with hash-addressed MP3 files.
6. Import the generated manifest into the editor, then save/export the log JSON.
   Messages are updated with `ttsHash`, `ttsAudioUrl`, `ttsVoiceName`, and
   `ttsCharCount`. The viewer only reads `ttsAudioUrl`.

The editor normalizes Unicode to NFC, normalizes horizontal whitespace, and
preserves line breaks. Hashes include normalized text, language, voice, rate,
pitch, volume, MP3 encoding, and engine version; they do not include role name,
message ID, order, or timestamp. Identical text and voice settings share one
generation task.

The scanner excludes chapter markers, empty text, CoC roll commands and
standalone dice formulas. The existing editor's non-main channel classifier
also treats `other`/`其他`/`聊天`/`杂谈`/`闲谈` as chatter for this toggle.

## Local setup

Use Python 3.10 or later. `boto3` is needed for R2 upload; FFmpeg is needed only
when a message exceeds the Google request byte limit and must be merged.

```powershell
python -m pip install -r tools\tts\requirements.txt
$env:GOOGLE_TTS_API_KEY = "your-google-api-key"
$env:R2_ACCOUNT_ID = "your-cloudflare-account-id"
$env:R2_ACCESS_KEY_ID = "your-r2-access-key-id"
$env:R2_SECRET_ACCESS_KEY = "your-r2-secret-access-key"
$env:R2_BUCKET_NAME = "trpg-audio"
$env:R2_PUBLIC_BASE_URL = "https://your-public-audio-domain"
python tools\tts\generate.py .tts-output\tasks.json --dry-run
python tools\tts\generate.py .tts-output\tasks.json
```

`R2_PUBLIC_BASE_URL` can be a public R2 development subdomain or a custom
domain. R2 credentials and the Google key are read only from environment
variables by the local script. Never commit them.

`TTS_MONTHLY_CHAR_LIMIT` is an optional additional hard ceiling. When set, the
script uses the lower of it and the budget in the task file. It checks existing
manifest usage plus this task's preview usage and all missing unique task
characters before making any synthesis request. Preview requests are counted
in the editor's local monthly usage and included in task exports.

The default editor budget is one million characters, but this is only a local
safety cap, not a promise of Google's free allowance. Google pricing and free
tiers depend on the voice family and account; verify the current Google Cloud
pricing/quota before generating. The script aborts before synthesis if the
configured ceiling would be exceeded.

For a local-only generation test, pass `--no-upload`; the Google API key is
still required. `--dry-run` makes no Google or R2 requests.

## R2 layout and long messages

Audio objects are stored at `audio/<first-two-hash-characters>/<hash>.mp3`.
The manifest is stored at `manifest.json`. Audio objects receive a one-year
immutable cache header; the manifest is uploaded with `no-cache`.

Long text is split at sentence and line boundaries, then at Unicode character
boundaries, keeping each Google request below 4,500 UTF-8 bytes. Multiple MP3
segments are joined with FFmpeg. Completed audio and the local manifest are
preserved under `.tts-output` so interrupted runs can resume without repeating
completed hashes.

Run the local helper tests with:

```powershell
python -m unittest discover -s tools\tts -p "test_*.py"
```
