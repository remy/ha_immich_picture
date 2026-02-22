"""Camera platform for Immich – a rotating slideshow of photos."""

from __future__ import annotations

import logging
import pathlib
from datetime import timedelta
from typing import Any

from homeassistant.components.camera import Camera
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.event import async_track_time_interval

from .const import (
    API_ENDPOINTS,
    CONF_API_ENDPOINT,
    CONF_ROTATION_INTERVAL,
    DEFAULT_ROTATION_INTERVAL,
    DOMAIN,
)
from .coordinator import ImmichDataUpdateCoordinator

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the Immich camera entity from a config entry."""
    coordinator: ImmichDataUpdateCoordinator = hass.data[DOMAIN][config_entry.entry_id]
    async_add_entities([ImmichCamera(coordinator, config_entry)], update_before_add=True)


class ImmichCamera(Camera):
    """A camera entity that rotates through photos returned by the Immich API.

    The entity fetches image bytes directly from Immich whenever Home Assistant
    requests a snapshot (e.g. for the dashboard picture card).  A separate
    timer advances the current photo index at the configured rotation interval
    so the displayed image changes over time without requiring a page reload.

    Each successfully downloaded thumbnail is written to a per-asset cache file
    on disk.  If Immich is unreachable, the most recent cached file for the
    requested asset is served instead, making the entity resilient to planned
    or unplanned server downtime.
    """

    _attr_has_entity_name = True
    _attr_content_type = "image/jpeg"
    # This is a read-only, non-streaming camera
    _attr_is_streaming = False

    def __init__(
        self,
        coordinator: ImmichDataUpdateCoordinator,
        config_entry: ConfigEntry,
    ) -> None:
        """Initialise the camera."""
        super().__init__()
        self._coordinator = coordinator
        self._config_entry = config_entry

        self._current_index: int = 0
        self._current_image_bytes: bytes | None = None
        self._rotation_unsubscribe = None
        self._cache_dir: pathlib.Path | None = None

        endpoint_label = API_ENDPOINTS.get(
            config_entry.data.get(CONF_API_ENDPOINT, ""), "Immich Picture"
        )

        self._attr_name = f"Immich Picture Slideshow – {endpoint_label}"
        self._attr_unique_id = config_entry.entry_id
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, config_entry.entry_id)},
            name="Immich Picture",
            manufacturer="Immich",
            model="Photo Server",
            configuration_url=coordinator.host,
        )

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def async_added_to_hass(self) -> None:
        """Register coordinator listener and start the rotation timer."""
        await super().async_added_to_hass()

        # Prepare the on-disk image cache directory
        cache_dir = pathlib.Path(
            self.hass.config.path(DOMAIN, "image_cache", self._config_entry.entry_id)
        )
        await self.hass.async_add_executor_job(
            lambda: cache_dir.mkdir(parents=True, exist_ok=True)
        )
        self._cache_dir = cache_dir

        # Listen for coordinator data updates so we reset gracefully
        self.async_on_remove(
            self._coordinator.async_add_listener(self._handle_coordinator_update)
        )

        # Start the rotation timer
        rotation_interval = self._config_entry.options.get(
            CONF_ROTATION_INTERVAL,
            self._config_entry.data.get(CONF_ROTATION_INTERVAL, DEFAULT_ROTATION_INTERVAL),
        )
        self._rotation_unsubscribe = async_track_time_interval(
            self.hass,
            self._async_rotate,
            timedelta(seconds=rotation_interval),
        )

        # Load the first image
        await self._load_current_image()

    async def async_will_remove_from_hass(self) -> None:
        """Clean up the rotation timer."""
        if self._rotation_unsubscribe is not None:
            self._rotation_unsubscribe()

    # ------------------------------------------------------------------
    # Camera interface
    # ------------------------------------------------------------------

    async def async_camera_image(
        self, width: int | None = None, height: int | None = None
    ) -> bytes | None:
        """Return the bytes for the currently displayed photo."""
        return self._current_image_bytes

    # ------------------------------------------------------------------
    # State attributes
    # ------------------------------------------------------------------

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        """Expose metadata about the current photo."""
        assets = self._coordinator.data
        if not assets:
            return {}

        idx = min(self._current_index, len(assets) - 1)
        asset = assets[idx]

        return {
            "asset_id": asset.get("id"),
            "filename": asset.get("originalFileName"),
            "taken_at": asset.get("localDateTime") or asset.get("fileCreatedAt"),
            "total_assets": len(assets),
            "current_index": idx + 1,
            "endpoint": self._config_entry.data.get(CONF_API_ENDPOINT),
        }

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @callback
    def _handle_coordinator_update(self) -> None:
        """Handle a fresh batch of assets from the coordinator."""
        assets = self._coordinator.data or []
        if assets and self._current_index >= len(assets):
            self._current_index = 0

        # Schedule fetching the new current image without blocking the callback
        self.hass.async_create_task(self._load_current_image())
        self.async_write_ha_state()

    async def _async_rotate(self, _now=None) -> None:
        """Advance to the next photo in the list."""
        assets = self._coordinator.data
        if not assets:
            return

        self._current_index = (self._current_index + 1) % len(assets)
        await self._load_current_image()
        self.async_write_ha_state()

    async def _load_current_image(self) -> None:
        """Fetch image bytes for the current asset from Immich.

        On success the bytes are written to disk so they can be served if
        Immich is unavailable during a later rotation cycle.  On any failure
        the cached file for this asset is used instead; if no cache exists the
        last in-memory image is preserved unchanged.
        """
        assets = self._coordinator.data
        if not assets:
            return

        idx = min(self._current_index, len(assets) - 1)
        asset = assets[idx]
        asset_id = asset.get("id")
        if not asset_id:
            return

        cache_file = (
            self._cache_dir / f"{idx}.jpg" if self._cache_dir is not None else None
        )

        url = f"{self._coordinator.host}/api/assets/{asset_id}/thumbnail?size=preview&edited=true&apiKey={self._coordinator.api_key}"
        session = async_get_clientsession(self.hass)
        try:
            async with session.get(
                url,
                headers={"x-api-key": self._coordinator.api_key},
                timeout=15,
            ) as resp:
                if resp.status == 200:
                    data = await resp.read()
                    self._current_image_bytes = data
                    if cache_file is not None:
                        await self.hass.async_add_executor_job(
                            cache_file.write_bytes, data
                        )
                else:
                    _LOGGER.warning(
                        "Immich returned HTTP %s for asset thumbnail %s",
                        resp.status,
                        asset_id,
                    )
                    await self._serve_from_cache(cache_file)
        except Exception as err:
            _LOGGER.debug("Error fetching Immich thumbnail for %s: %s", asset_id, err)
            await self._serve_from_cache(cache_file)

    async def _serve_from_cache(self, cache_file: pathlib.Path | None) -> None:
        """Load image bytes from the on-disk cache for this asset, if available."""
        if cache_file is None:
            return
        try:
            data = await self.hass.async_add_executor_job(cache_file.read_bytes)
            self._current_image_bytes = data
            _LOGGER.debug("Serving cached image: %s", cache_file.name)
        except FileNotFoundError:
            pass  # No cache yet for this asset; keep the last in-memory image
        except OSError as err:
            _LOGGER.debug("Could not read cache file %s: %s", cache_file, err)
