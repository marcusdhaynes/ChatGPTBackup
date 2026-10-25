# ChatGPTBackup

A private, installable, ChatGPT-style archive reader. It runs entirely inside the browser without uploading your data or contacting a server. This project is **independent of and not affiliated with OpenAI**.

## Open

Visit the GitHub Pages deployment, then drop in one of the following:

- A ChatGPT export ZIP, including newer exports with nested `Conversations__...zip` / `Files__...zip` archives.
- A standalone `conversations.json` or sharded `conversations-000.json`, `conversations-001.json`, etc.
- A folder containing the exported JSON, image files, uploads, and `.dat` files.
- Add more files afterward using **Import**. This fills in missing media in already-loaded conversations.

The app reconstructs the active conversation branch using the export's `current_node` and parent links. Turn on **Show alternate branches** to display other branches in chronological order. It recognizes ChatGPT text parts, multimodal pointers, attachment metadata, inline archive references, audio/video and document files. Missing files remain in-place as empty labeled placeholders with type icons and original export references.

### Search

Search over message text and titles; filter by date, number of messages, presence of attachments, and unavailable assets. Sort by newest, oldest, title or message count. Use `Ctrl/⌘ + K` or `/` to focus Search.

### Privacy and speed

- **No backend, telemetry, cloud indexing or remote file upload.** This is static HTML/CSS/JS; all archive operations run on-device.
- Conversation JSON is parsed in a Web Worker; massive top-level JSON arrays are handled one conversation at a time rather than `JSON.parse` of the entire archive at once.
- Compressed `.dat` / image / audio / video blobs inside ZIPs are decompressed **only when displayed or opened**, not during the initial index.
- ZIP64 central directories supported for very large archives (browser file-size limits still apply).
- Assets are indexed by name and export ID, with built-in magic-byte MIME detection for `.dat` files (images, WAV/MP3, PDF, MP4/WebM, etc.).
- Compatible with modern Chrome/Edge, Firefox, and Safari on Windows, macOS, Linux, Android, and iOS/iPadOS. Folder selection support varies by browser; users can select a ZIP instead.
- PWA manifest and service worker provide an installable app shell. Archive data itself **is not persisted**: load your file/folder again after refreshing; no secret backups are written to online storage.

### Limitations

- The export cannot recover assets that OpenAI omitted. Those appear as placeholders, not fabricated media.
- Unknown future export schema variants may need an importer update.
- Browser memory limits still apply: very large single conversations can take more memory. A worker keeps heavy parsing off the UI thread and messages render in progressive groups.
- Password-protected ZIP files and rare ZIP compression methods other than Store / Deflate are not supported.
- Requires a browser with `DecompressionStream('deflate-raw')` for compressed ZIPs.
- Media referenced only as inaccessible hosted URLs cannot be reconstructed offline.
- `chat.html` alone is not a substitute for the `conversations.json` data.

## Deploy to GitHub Pages

1. Create a **public** repository named `ChatGPTBackup` in your GitHub account.
2. Upload these root files and `.github/workflows/pages.yml`, or push this folder to its `main` branch.
3. In **Settings → Pages**, set **Build and deployment → Source: GitHub Actions**.
4. The workflow deploys automatically on each push to `main`, publishing at `https://YOUR_USERNAME.github.io/ChatGPTBackup/`.

No secrets, build tools, package installation, or runtime APIs are needed. `pages.yml` publishes the app directly.

## Run locally

**Easiest:** Open `ChatGPTBackup-Standalone.html` in your modern web browser. It contains the app, the ZIP engine, the indexing worker and the styling in one file. No installation required. If your browser restricts workers on `file://`, use the HTTP method below.

From this directory:

```bash
python -m http.server 8000
```

Open `http://localhost:8000/`. Service workers and module-based workers need HTTP(S), so opening `index.html` directly using `file://` may not work.

## Testing

The `tests/` folder contains a synthetic JSON generator. The test data is wholly fictional, never real user history.

## License

MIT — see [LICENSE](LICENSE).