"""Data update coordinator for Immich."""

from __future__ import annotations

import logging
from datetime import timedelta
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import (
    CONF_ALBUM_ID,
    CONF_API_ENDPOINT,
    CONF_API_PARAMS,
    CONF_ASSET_COUNT,
    CONF_HOST,
    CONF_API_KEY,
    CONF_SCAN_INTERVAL,
    DEFAULT_ASSET_COUNT,
    DEFAULT_SCAN_INTERVAL,
    DOMAIN,
    ENDPOINT_ALL,
    ENDPOINT_ALBUM,
    ENDPOINT_FAVORITES,
    ENDPOINT_RANDOM,
    ENDPOINT_SEARCH,
    ASSET_TYPE_IMAGE,
)

_LOGGER = logging.getLogger(__name__)


class ImmichDataUpdateCoordinator(DataUpdateCoordinator[list[dict[str, Any]]]):
    """Coordinator that periodically fetches an asset list from the Immich API."""

    def __init__(self, hass: HomeAssistant, config_entry: ConfigEntry) -> None:
        """Initialise the coordinator."""
        self.host: str = config_entry.data[CONF_HOST].rstrip("/")
        self.api_key: str = config_entry.data[CONF_API_KEY]
        self.endpoint: str = config_entry.data[CONF_API_ENDPOINT]
        self.album_id: str | None = config_entry.data.get(CONF_ALBUM_ID)
        self.asset_count: int = config_entry.options.get(
            CONF_ASSET_COUNT,
            config_entry.data.get(CONF_ASSET_COUNT, DEFAULT_ASSET_COUNT),
        )
        self.api_params: dict[str, Any] = config_entry.options.get(
            CONF_API_PARAMS,
            config_entry.data.get(CONF_API_PARAMS, {}),
        )

        scan_interval: int = config_entry.options.get(
            CONF_SCAN_INTERVAL,
            config_entry.data.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL),
        )

        super().__init__(
            hass,
            _LOGGER,
            name=f"{DOMAIN}_{config_entry.entry_id[:8]}",
            update_interval=timedelta(seconds=scan_interval),
        )

    @property
    def _headers(self) -> dict[str, str]:
        return {
            "x-api-key": self.api_key,
            "Accept": "application/json",
        }

    async def _async_update_data(self) -> list[dict[str, Any]]:
        """Fetch the current asset list from Immich."""
        session = async_get_clientsession(self.hass)

        try:
            assets = await self._fetch_assets(session)
        except Exception as err:
            raise UpdateFailed(f"Error communicating with Immich API: {err}") from err

        # Keep only image assets so the camera entity always has a displayable frame.
        # (Videos cannot be served as still images.)
        image_assets = [a for a in assets if a.get("type") == ASSET_TYPE_IMAGE]

        # Keep only landscape (wide) images; skip portraits and squares.
        landscape_assets = [
            a for a in image_assets
            if a.get("width") and a.get("height") and a["width"] > a["height"]
        ]

        if not landscape_assets:
            _LOGGER.warning(
                "Immich returned no landscape image assets for endpoint '%s'", self.endpoint
            )

        return landscape_assets

    async def _fetch_assets(self, session) -> list[dict[str, Any]]:
        """Route to the correct API call based on the configured endpoint."""

        if self.endpoint == ENDPOINT_RANDOM:
            return await self._fetch_random(session)
        if self.endpoint == ENDPOINT_ALL:
            return await self._fetch_all(session)
        if self.endpoint == ENDPOINT_ALBUM:
            return await self._fetch_album(session)
        if self.endpoint == ENDPOINT_FAVORITES:
            return await self._fetch_favorites(session)
        if self.endpoint == ENDPOINT_SEARCH:
            return await self._fetch_search(session)

        raise UpdateFailed(f"Unknown endpoint configured: {self.endpoint}")

    # ------------------------------------------------------------------
    # Individual endpoint helpers
    # ------------------------------------------------------------------

    async def _fetch_random(self, session) -> list[dict[str, Any]]:
        url = f"{self.host}/api/search/random"
        body: dict[str, Any] = {"count": self.asset_count}
        body.update({k: v for k, v in self.api_params.items() if v not in (None, "")})
        async with session.post(url, headers=self._headers, json=body) as resp:
            resp.raise_for_status()
            data = await resp.json()
        return data if isinstance(data, list) else []

    async def _fetch_all(self, session) -> list[dict[str, Any]]:
        url = f"{self.host}/api/assets"
        params: dict[str, Any] = {
            "page": 1,
            "size": self.asset_count,
        }
        # Merge any extra user-supplied query params (type, isFavorite, etc.)
        for key, val in self.api_params.items():
            if val not in (None, ""):
                params[key] = val
        async with session.get(url, headers=self._headers, params=params) as resp:
            resp.raise_for_status()
            data = await resp.json()
        # The Immich API can return a bare list or a paginated envelope
        if isinstance(data, list):
            return data
        return data.get("assets", {}).get("items", []) if isinstance(data, dict) else []

    async def _fetch_album(self, session) -> list[dict[str, Any]]:
        if not self.album_id:
            _LOGGER.error("Album endpoint selected but no album_id configured")
            return []
        url = f"{self.host}/api/albums/{self.album_id}"
        async with session.get(url, headers=self._headers) as resp:
            resp.raise_for_status()
            data = await resp.json()
        return data.get("assets", []) if isinstance(data, dict) else []

    async def _fetch_favorites(self, session) -> list[dict[str, Any]]:
        url = f"{self.host}/api/assets"
        params: dict[str, Any] = {
            "page": 1,
            "size": self.asset_count,
            "isFavorite": "true",
        }
        async with session.get(url, headers=self._headers, params=params) as resp:
            resp.raise_for_status()
            data = await resp.json()
        if isinstance(data, list):
            return data
        return data.get("assets", {}).get("items", []) if isinstance(data, dict) else []

    async def _fetch_search(self, session) -> list[dict[str, Any]]:
        url = f"{self.host}/api/search/metadata"
        body: dict[str, Any] = {"size": self.asset_count}
        body.update({k: v for k, v in self.api_params.items() if v not in (None, "")})
        async with session.post(url, headers=self._headers, json=body) as resp:
            resp.raise_for_status()
            data = await resp.json()
        return (
            data.get("assets", {}).get("items", []) if isinstance(data, dict) else []
        )
