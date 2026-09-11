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
CONF_ORIENTATION = "orientation"
CONF_MISMATCH_HANDLING = "mismatch_handling"

# Defaults
DEFAULT_SCAN_INTERVAL = 300  # seconds (5 minutes)
DEFAULT_ROTATION_INTERVAL = 30  # seconds
DEFAULT_ASSET_COUNT = 50

# Card orientation – which shape of photo fits the dashboard card natively
ORIENTATION_LANDSCAPE = "landscape"
ORIENTATION_PORTRAIT = "portrait"
DEFAULT_ORIENTATION = ORIENTATION_LANDSCAPE

ORIENTATION_OPTIONS: dict[str, str] = {
    ORIENTATION_LANDSCAPE: "Landscape (wide card)",
    ORIENTATION_PORTRAIT: "Portrait (tall card)",
}

# What to do with photos in the opposite orientation to the card
MISMATCH_COMBINE = "combine"
MISMATCH_INCLUDE = "include"
MISMATCH_SKIP = "skip"
DEFAULT_MISMATCH_HANDLING = MISMATCH_COMBINE

MISMATCH_OPTIONS: dict[str, str] = {
    MISMATCH_COMBINE: "Combine two into one composite",
    MISMATCH_INCLUDE: "Show them as they are",
    MISMATCH_SKIP: "Skip them",
}

# Axis used when compositing two photos into one
AXIS_HORIZONTAL = "horizontal"
AXIS_VERTICAL = "vertical"

# Endpoint identifiers
ENDPOINT_RANDOM = "random_assets"
ENDPOINT_ALL = "all_assets"
ENDPOINT_ALBUM = "album_assets"
ENDPOINT_FAVORITES = "favorite_assets"
ENDPOINT_SEARCH = "search_metadata"
ENDPOINT_MEMORIES = "memory_assets"

# Human-readable endpoint names (used in UI)
API_ENDPOINTS: dict[str, str] = {
    ENDPOINT_RANDOM: "Random Assets",
    ENDPOINT_ALL: "All Assets (Recent)",
    ENDPOINT_ALBUM: "Album Assets",
    ENDPOINT_FAVORITES: "Favorite Assets",
    ENDPOINT_SEARCH: "Search by Metadata",
    ENDPOINT_MEMORIES: "Memory Assets",
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
