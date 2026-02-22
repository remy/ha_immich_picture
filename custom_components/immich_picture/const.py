"""Constants for the Immich integration."""

DOMAIN = "immich_picture"

# Config entry keys
CONF_API_KEY = "api_key"
CONF_HOST = "host"
CONF_API_ENDPOINT = "api_endpoint"
CONF_API_PARAMS = "api_params"
CONF_ALBUM_ID = "album_id"
CONF_ASSET_COUNT = "asset_count"
CONF_ROTATION_INTERVAL = "rotation_interval"
CONF_SCAN_INTERVAL = "scan_interval"

# Defaults
DEFAULT_SCAN_INTERVAL = 300  # seconds (5 minutes)
DEFAULT_ROTATION_INTERVAL = 30  # seconds
DEFAULT_ASSET_COUNT = 50

# Endpoint identifiers
ENDPOINT_RANDOM = "random_assets"
ENDPOINT_ALL = "all_assets"
ENDPOINT_ALBUM = "album_assets"
ENDPOINT_FAVORITES = "favorite_assets"
ENDPOINT_SEARCH = "search_metadata"

# Human-readable endpoint names (used in UI)
API_ENDPOINTS: dict[str, str] = {
    ENDPOINT_RANDOM: "Random Assets",
    ENDPOINT_ALL: "All Assets (Recent)",
    ENDPOINT_ALBUM: "Album Assets",
    ENDPOINT_FAVORITES: "Favorite Assets",
    ENDPOINT_SEARCH: "Search by Metadata",
}

# Asset types supported by Immich API
ASSET_TYPE_IMAGE = "IMAGE"
ASSET_TYPE_VIDEO = "VIDEO"
ASSET_TYPE_ALL = "ALL"

ASSET_TYPE_OPTIONS: dict[str, str] = {
    ASSET_TYPE_IMAGE: "Images only",
    ASSET_TYPE_VIDEO: "Videos only",
    ASSET_TYPE_ALL: "Images and Videos",
}
