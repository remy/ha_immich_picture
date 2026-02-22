# Scraper Home Assistant add-on

Scraper exposes an Express web UI for uploading Puppeteer scripts and calls those scripts through `/api/<script>` routes.

[![Open your Home Assistant instance and show the add add-on repository dialog with a specific repository URL pre-filled.](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Fremy%2Fscraper)

## Installation

1. Add this repository under **Settings → Add-ons → Add-on store → … → Repositories** or copy the folder into your local `/addons` share.
2. Install the **Scraper** add-on.
3. Open the add-on and start it. Use **OPEN WEB UI** (ingress) to access the upload UI.

## Configuration

| Option        | Default                   | Description                                                                                                                                                            |
| ------------- | ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts_dir` | `/config/scripts`         | Folder inside the container where uploaded scripts are saved and read by the `/api` routes.                                                                            |
| `env_vars`    | `{"EXAMPLE_API_KEY": ""}` | Key/value pairs injected into the add-on process as environment variables (useful for API keys or secrets). Replace/remove the example entry and add your own secrets. |

`/config/scripts` lives under Home Assistant's `/addon_configs/<repository>_scraper/scripts`, so you can edit scripts directly over Samba/SSH. Point `scripts_dir` to `/share/...` if you prefer storing them in the shared folder. The add-on seeds the configured directory with the example scripts if it is empty.

The web UI includes a syntax-highlighted editor (CodeMirror) for quick tweaks, plus inline preview/rename/delete actions, but storing and editing files externally is still recommended for complex scripts.

## Ports

- `3000/tcp` – optional direct access to the Express UI (disabled by default, ingress is recommended).

## Local testing

Use the included VS Code devcontainer (`.devcontainer/devcontainer.json`) and run the **Start Home Assistant** task, or build locally with:

```sh
docker build --build-arg BUILD_FROM="ghcr.io/home-assistant/amd64-base:latest" -t scraper-local .
```

Run it with:

```sh
docker run --rm -it -v "$(pwd)/scripts:/config/scripts" -p 4545:3000 scraper-local
```

