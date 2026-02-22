# Immich Picture – Home Assistant Integration

A Home Assistant custom integration that turns your [Immich](https://immich.app) photo server into a rotating picture slideshow, exposed as a `camera` entity. Drop it onto any dashboard with a **Picture card** or **Picture Glance card** and your photos cycle automatically.

---

## Features

- **Five photo sources** – random, all recent, by album, favourites only, or metadata search
- **Filterable random & search** – POST a JSON body to the Immich API to narrow results by person, city, date range, type, and more
- **Configurable rotation** – set how often the displayed photo changes (5 s – 1 h)
- **Configurable refresh** – set how often a fresh batch of assets is fetched from Immich (1 min – 24 h)
- **Resilient image cache** – every downloaded thumbnail is written to disk; if Immich is unreachable the last cached version of each photo is served instead
- **Multiple instances** – add the integration more than once to run several slideshows (e.g. one per album or one per room) simultaneously
- **Live reconfiguration** – all timing, count, and JSON filter settings are editable via the ⚙ configure button without removing and re-adding the integration

---

## Requirements

- Home Assistant 2023.x or later
- An Immich instance reachable from your HA host (local network or VPN)
- An Immich API key (generate one under **Account Settings → API Keys**)

---

## Installation

### HACS (recommended)

1. Open HACS → **Integrations** → ⋮ → **Custom repositories**
2. Add this repository URL and select category **Integration**
3. Search for **Immich Picture** and install
4. Restart Home Assistant

### Manual

1. Copy the `custom_components/immich_picture/` folder into your HA config directory under `custom_components/`
2. Restart Home Assistant

---

## Setup

1. Go to **Settings → Devices & Services → Add Integration** and search for **Immich Picture**
2. Enter your Immich URL (e.g. `http://192.168.1.100:2283`) and API key
3. Choose a **photo source** (see below)
4. Configure source-specific options (asset count, JSON filter, etc.)
5. Set rotation and refresh intervals
6. The integration creates a `camera` entity ready to use on any dashboard

---

## Photo Sources

### Random Assets

Fetches a random selection of photos each refresh cycle using `POST /api/search/random`.

Supports an optional JSON filter body to narrow the random pool:

```json
{
  "personIds": ["uuid-of-person-1", "uuid-of-person-2"],
  "country": "Japan",
  "type": "IMAGE"
}
```

[API reference](https://api.immich.app/endpoints/search/searchRandom)

---

### All Assets (Recent)

Fetches the most recent assets from your library, ordered newest-first or oldest-first.

---

### Album Assets

Fetches all photos from a specific album. Albums are loaded from Immich during setup so you can pick from a dropdown.

---

### Favourite Assets

Fetches only photos you have marked as a favourite in Immich.

---

### Search by Metadata

Fetches photos matching a JSON metadata query using `POST /api/search/metadata`. This is the most powerful source — you can filter by city, country, date range, camera make/model, whether the photo is archived, a favourite, a specific person, and more.

```json
{
  "city": "Paris",
  "isFavorite": true,
  "type": "IMAGE",
  "takenAfter": "2023-01-01T00:00:00Z"
}
```

[API reference](https://api.immich.app/endpoints/search/searchAssets)

---

## Options (⚙ Configure)

After initial setup you can adjust the following via the **configure** button without restarting:

| Setting | Description | Range |
|---|---|---|
| Photo rotation interval | How often the displayed image advances | 5 s – 3600 s |
| API refresh interval | How often a fresh batch is fetched from Immich | 60 s – 86400 s |
| Number of assets | Size of the asset pool loaded per refresh | 1 – 500 |
| Filter (JSON) | JSON body for the API request *(random & search only)* | any valid JSON object |

Changes take effect immediately — the integration reloads automatically when you save.

---

## Image Cache

Every thumbnail that is successfully downloaded is written to:

```
<ha-config-dir>/immich_picture/image_cache/<entry-id>/<asset-id>.jpg
```

**When Immich is available** the cache file is overwritten with the freshest version.

**When Immich is unreachable** (planned downtime, network outage, server restart) the integration serves the last cached file for each photo instead of showing a blank or broken image. If a photo has never been fetched before and therefore has no cache entry, the previously displayed image is preserved unchanged.

Cache files accumulate over time but are small (typically 50–200 KB each). You can delete the cache directory at any time — it is recreated automatically on the next successful fetch.

---

## Dashboard Usage

Add a **Picture card** or **Picture Glance card** and point it at the `camera.immich_picture_slideshow_*` entity. The image updates automatically at the configured rotation interval with no page reload required.

The entity also exposes state attributes you can use in automations or template sensors:

| Attribute | Description |
|---|---|
| `asset_id` | Immich UUID of the current photo |
| `filename` | Original file name |
| `taken_at` | Date/time the photo was taken |
| `total_assets` | Number of assets in the current pool |
| `current_index` | 1-based position in the pool |
| `endpoint` | Configured photo source identifier |

---

## Troubleshooting

**No image shown on startup** — ensure HA can reach your Immich URL. Check **Settings → System → Logs** and filter for `immich_picture`.

**Images stop updating but the card still shows a photo** — Immich is likely unreachable; the cache is being served. The integration will resume live images automatically once Immich is back.

**"Unable to connect" during setup** — verify the URL includes the port (e.g. `http://192.168.1.100:2283`) and that the API key is correct.

**JSON filter rejected** — the field must be a valid JSON *object* (curly-brace wrapper, not an array). Use a tool like [jsonlint.com](https://jsonlint.com) to validate before pasting.
