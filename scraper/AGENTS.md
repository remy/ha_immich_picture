# Agent Onboarding Guide

This repository powers a Home Assistant add-on for running Puppeteer-based scripts via an Express server. Below is everything an AI agent (or any developer) needs to know to pick up the project.

---

## Project Purpose
- Provide a UI and API for uploading, editing, and executing custom Puppeteer scripts inside Home Assistant.
- Scripts live under `/config/scripts` (maps to `/addon_configs/<repo>_scraper/scripts` in HA).
- `/api/<script>` dynamically loads `<script>.mjs`, calls its default export (an async function receiving `req, res, browser`) and returns JSON.
- UI runs inside Home Assistant’s ingress (so routing accommodates `X-Ingress-Path`).

---

## Key Components
| Path | Description |
| --- | --- |
| `index.mjs` | Express application: ingress handling, CodeMirror UI template, script CRUD endpoints, Puppeteer runner. |
| `views/home.ejs` | HTML template rendered at `/`. References static CSS/JS and includes template data. |
| `public/css/style.css` | Styling for light/dark modes, layout, modal, etc. |
| `public/js/app.js` | Client-side logic: mode switching, CodeMirror editor, rename/delete modal, list refresh, etc. |
| `config.yaml` / `build.yaml` | Home Assistant add-on metadata (name, ingress, env-vars, architecture, etc.). |
| `run.sh` | Add-on entry script: reads `/data/options.json`, mounts scripts dir, exports `env_vars`. |
| `Dockerfile` | Node + Chromium + `run.sh`, optimized for HA base images. |
| `scripts/*.mjs` | Example Puppeteer scripts (copied to `/config/scripts` on first run). |
| `public/` | Static assets served by Express (CSS, JS, fonts). |
| `translations/` | Supervisor UI translations (configuration options, port descriptions). |

---

## Development Workflow
1. **Install dependencies**: `npm install` (requires Node 18+).
2. **Run locally**: `npm start` (starts Express app real-time). For Puppeteer, ensure Chromium exists (see Dockerfile).
3. **Devcontainer / HA testing**:
   - Use `.devcontainer/devcontainer.json` (Home Assistant dev environment with Supervisor).
   - Alternatively, build add-on image and install locally.
4. **Home Assistant integration**:
   - `config.yaml` defines add-on metadata, ingress, options (e.g., `env_vars`, `scripts_dir`).
   - Add-on code expects `SCRIPTS_DIR` (defaults to `/config/scripts` in HA).
   - `env_vars` map to environment variables for storing secrets/keys (set through Supervisor UI).

---

## UI Behavior
### Endpoints View (default)
- Upload form (file + optional name override).
- Each script row offers:
  - `Call API` (opens `/api/<script>` in new tab)
  - `Edit` (switches to editor view and loads script)
  - `Rename` (prompt, server-side rename)
  - `Delete` (modal confirmation)
- List auto-refreshes after script changes.

### Editor View
- CodeMirror text area for quick edits.
- Buttons: “Insert template”, “New script”, “Save script”.
- Name field read-only when editing an existing script; can start a new file via “New script”.
- Uses `/scripts/save` JSON endpoint (auto-wraps missing `export default async function handler` for `.mjs` files).

---

## API / Endpoints
| Endpoint | Method | Description |
| --- | --- | --- |
| `/` | GET | Renders UI (`home.ejs` + static CSS/JS). |
| `/scripts/list` | GET | Returns `{ scripts: [...] }`. |
| `/scripts/content/:file` | GET | Returns `{ fileName, content }`. |
| `/scripts/save` | POST | Body: `{ fileName?, scriptName, scriptContent }`. Always writes `.mjs` files (wraps a default export). |
| `/scripts/rename` | POST | Body: `{ originalFileName, newName }`. Renames file, enforcing a `.mjs` extension. |
| `/scripts/:fileName` | DELETE | Removes script. |
| `/upload-file` | POST (multipart) | Upload script file. |
| `/upload-text` | POST (form) | Legacy form handler for text-based script creation. |
| `/api/:script` | GET | Executes `<script>.mjs` default export and returns JSON. (Puppeteer browser is launched at startup.) |

**Notes**:
- `ensureDefaultExport` ensures `.mjs` files contain `export default async function handler`.
- Paths sanitized via `sanitizeScriptName` and `getResolvedPath`.
- On add-on start, `scripts/` folder from repo is copied to `SCRIPTS_DIR` if empty.

---

## Environment / Configuration
### `config.yaml` options
| Option | Default | Purpose |
| --- | --- | --- |
| `scripts_dir` | `/config/scripts` | Filesystem location of user scripts (mounted to `/addon_configs/<repo>_scraper/scripts`). |
| `env_vars` | `{"EXAMPLE_API_KEY": ""}` | Key/value map injected into Node process. Update via Supervisor UI. |

### Environment variables
- `SCRIPTS_DIR`: target script directory.
- `PUPPETEER_EXECUTABLE_PATH`: set to Chromium binary (Dockerfile).
- Others from `env_vars`.

---

## Puppeteer Execution
- Browser launched once with headless + safe flags (`--no-sandbox`, etc.).
- Scripts import dynamic modules via `import(scriptPath + '?cacheBust=...')` to bypass cache.
- Scripts expected to export `default async function handler(req,res,browser)`.

---

## Security Considerations
1. **Path Sanitization**: Reuse `getResolvedPath` and `sanitizeScriptName` when adding new file-based features.
2. **Ingress**: Use `withIngressPath(req, path)` + `getIngressPath` for generating URLs inside HA ingress.
3. **Uploads**: Multer restricts file names and every file is normalized to `.mjs`, but still rely on sanitize helpers when adding new file features.
4. **Secrets**: Encourage storing credentials via `env_vars` instead of embedding in scripts.

---

## How to Extend
- **New script actions**: Add button in UI, implement server endpoint, update `public/js/app.js`.
- **Logs/testing**: Consider adding script-run logs or “Test API” button showing result inline.
- **Auth/headers**: Extend `/api/:script` to pass extra headers/per-request context as needed.
- **Scheduler**: Could integrate with HA services or add a scheduler (not currently implemented).

---

## Common Tasks
| Task | Where |
| --- | --- |
| Update styling | `public/css/style.css` |
| Modify UI | `views/home.ejs` + `public/js/app.js` |
| Adjust script validation | `index.mjs` (functions `ensureDefaultExport`, `getResolvedPath`, etc.) |
| Add HA option | `config.yaml`, `translations/en.yaml`, `run.sh`, `README.md` |
| Extend API (server) | `index.mjs` |
| Modify Docker behavior | `Dockerfile` |

---

## Testing / Validation
- Run `npm start` locally and open `http://localhost:3000`.
- Use HA devcontainer or `docker build` to validate add-on packaging.
- Exercise UI: upload, rename, delete, edit scripts. Confirm API call results.
- Check `/scripts_dir` is seeded with sample scripts on first launch.

---

## Supportive Scripts / Tools
- `run.sh`: Boot script used in Docker image/add-on.
- `.devcontainer` + `.vscode/tasks.json`: Launch HA dev environment.
- `scripts/*.mjs`: Sample scrapers (e.g., `test.mjs` template).

---

## Final Tips for Agents
1. **Respect existing sanitization and preview logic**—reuse helper functions.
2. **Mind HA ingress**: Always generate URLs through `withIngressPath` when referencing server endpoints.
3. **Keep UI accessible**: Use the provided CSS structure; new features need dark/light compatibility.
4. **Document changes**: Update README/DOCS as workflow changes (especially new options or UI behaviors).
5. **When in doubt**: Search for existing patterns in repo (like rename/delete endpoints) before reinventing.

Happy hacking! The structure is purposely clean—keep scripts modular and ensure that any new features harmonize with the existing UI/UX.
