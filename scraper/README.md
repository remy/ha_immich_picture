# Scraper

## Home Assistant add-on

The repository now doubles as a Home Assistant add-on. To test it locally you can either copy the folder into your `/addons` share or add the GitHub repository URL under **Settings → Add-ons → Add-on store → … → Repositories**. Then:

1. Install **Scraper** from the add-on list.
2. (Optional) Add `env_vars` key/value pairs (API keys, credentials, etc.). They are exported to the Node process as environment variables on startup. A sample `EXAMPLE_API_KEY` entry is provided—replace it or add more secrets as needed.
3. (Optional) Adjust the `scripts_dir` option if you prefer saving uploads somewhere other than the default `/config/scripts` (for example `/share/scraper`).

The add-on exposes an ingress-friendly Express UI as well as the existing `/api/<script>` HTTP endpoints.

From here you can create `rest` entities:

```yaml
rest:
  - resource: http://homeassistant.local:3333/api/ukbin
  scan_interval: 28800
  headers:
    Content-Type: application/json
  sensor:
    - name: "Refuse Collection"
      value_template: {{ value_json.refuse }}
```



## Upload UI

Visiting the root (`/`) path shows a small management page that lets you:

- Upload script files (regardless of their original extension) — they are stored under the configured scripts directory as `.mjs` modules.
- Paste raw script/data text and save it as a `.mjs` file.
- Review which files currently live inside the scripts directory.
- Rename or delete scripts directly from the UI, or preview their contents before editing/calling an endpoint.

The Express app watches `SCRIPTS_DIR` (defaults to `/config/scripts` inside Home Assistant or the bundled `/app/scripts` when running standalone). The add-on seeds that directory with the example scripts from this repo the first time it runs, so you always have a starting point before uploading your own files. Uploading new files or text immediately makes them available at `/api/<script-name>`. You can edit the files directly from Home Assistant by browsing to `/addon_configs/x_scraper/scripts` via SSH/Samba; any edits are reflected immediately. The inline editor uses a syntax-highlighted CodeMirror field for quick tweaks and includes rename/delete actions, but external editors are still recommended for larger changes.

## Scripts

There's an "Insert Template" feature. Each `.mjs` file should `export default async function handler(req, res, browser)`, though legacy scripts with `export async function run` are still supported. The handler is invoked with three arguments and whatever you return will be serialized as the API response:

- request - the full (node) request object
- response - an Express based response API - possibly only use for headers
- browser - an instance of Chrome, which you can call `await browser.newPage()`

## Local add-on testing

This repository already includes the [recommended Home Assistant devcontainer setup](https://developers.home-assistant.io/docs/add-ons/testing). To spin it up:

1. Install the VS Code **Remote Containers** extension.
2. Open this repo in VS Code and choose **Reopen in Container** when prompted.
3. Run the `Start Home Assistant` task (Terminal → Run Task) to boot Supervisor + Home Assistant (`http://localhost:7123`).
4. Your add-on appears under **Settings → Add-ons → Local add-ons** automatically, so you can install and test it exactly as the Production add-on.

If you prefer testing outside of the devcontainer, you can still run the add-on locally with Docker:

```sh
docker run --rm -it \
  -v "$(pwd)/scripts:/config/scripts" \
  -p 4545:3000 \
  scraper-local
```

Build the test image first with `docker build --build-arg BUILD_FROM="ghcr.io/home-assistant/amd64-base:latest" -t scraper-local .`.
