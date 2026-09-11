"""Camera platform for Immich – a rotating slideshow of photos."""

from __future__ import annotations

import io
import logging
import pathlib
from datetime import timedelta
from time import monotonic
from typing import Any

from PIL import Image, ImageOps

from homeassistant.components.camera import Camera
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.event import async_track_time_interval

from .const import (
    API_ENDPOINTS,
    AXIS_VERTICAL,
    CONF_API_ENDPOINT,
    CONF_CROSSFADE_DURATION,
    CONF_CROSSFADE_ENABLED,
    CONF_ROTATION_INTERVAL,
    CROSSFADE_STEPS,
    DEFAULT_CROSSFADE_DURATION,
    DEFAULT_CROSSFADE_ENABLED,
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
        self._next_index: int | None = None
        self._next_image_bytes: bytes | None = None
        self._prev_image_bytes: bytes | None = None
        self._transition_started: float | None = None
        self._blend_cache: tuple[int, bytes] | None = None
        self._rotation_interval: float = DEFAULT_ROTATION_INTERVAL
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

        # Restore a displayable image immediately after startup, even if the
        # initial Immich refresh failed and no asset list is available yet.
        await self._restore_startup_image_from_cache()

        # Listen for coordinator data updates so we reset gracefully
        self.async_on_remove(
            self._coordinator.async_add_listener(self._handle_coordinator_update)
        )

        # Start the rotation timer
        rotation_interval = self._config_entry.options.get(
            CONF_ROTATION_INTERVAL,
            self._config_entry.data.get(CONF_ROTATION_INTERVAL, DEFAULT_ROTATION_INTERVAL),
        )
        self._rotation_interval = float(rotation_interval)
        self._rotation_unsubscribe = async_track_time_interval(
            self.hass,
            self._async_rotate,
            timedelta(seconds=rotation_interval),
        )

        # Load the first image, then prefetch the next one in the background
        # so the first rotation already has a buffered image to display.
        await self._load_current_image()
        self.hass.async_create_task(self._load_next_image())

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
        """Return the bytes for the currently displayed photo.

        While a crossfade is in flight the outgoing and incoming photos are
        blended on demand at whatever progress the caller asks at, so the
        dissolve renders at the client's own refresh rate instead of this
        entity having to guess it.
        """
        frame = await self._async_blended_frame()
        if frame is not None:
            return frame
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

        next_asset_id: str | None = None
        if (
            self._next_index is not None
            and 0 <= self._next_index < len(assets)
            and self._next_image_bytes is not None
        ):
            next_asset_id = assets[self._next_index].get("id")

        return {
            "asset_id": asset.get("id"),
            "filename": asset.get("originalFileName"),
            "taken_at": asset.get("localDateTime") or asset.get("fileCreatedAt"),
            "total_assets": len(assets),
            "current_index": idx + 1,
            "endpoint": self._config_entry.data.get(CONF_API_ENDPOINT),
            "next_asset_id": next_asset_id,
            "crossfading": self._transition_progress() is not None,
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

        # Asset list has changed, so any prefetched "next" buffer is stale.
        self._next_index = None
        self._next_image_bytes = None

        # Schedule fetching the new current image without blocking the callback,
        # then refresh the prefetched next image so the upcoming rotation has
        # something to dissolve into.
        self.hass.async_create_task(self._load_current_image())
        self.hass.async_create_task(self._load_next_image())

        # Prune any slot files beyond the new asset count
        if self._cache_dir is not None and assets:
            self.hass.async_create_task(self._prune_cache(len(assets)))

        self.async_write_ha_state()

    def _crossfade_settings(self) -> tuple[bool, float]:
        """Read the (enabled, duration) crossfade settings from options.

        The duration is clamped to the rotation interval so a fade always
        finishes before the next photo is due.
        """
        opts = {**self._config_entry.data, **self._config_entry.options}
        enabled = bool(opts.get(CONF_CROSSFADE_ENABLED, DEFAULT_CROSSFADE_ENABLED))
        duration = float(
            opts.get(CONF_CROSSFADE_DURATION, DEFAULT_CROSSFADE_DURATION)
        )
        return enabled, min(duration, self._rotation_interval)

    def _transition_progress(self) -> float | None:
        """Return how far the running crossfade has got, or ``None`` if idle."""
        if self._transition_started is None or self._prev_image_bytes is None:
            return None

        enabled, duration = self._crossfade_settings()
        if not enabled or duration <= 0:
            return None

        progress = (monotonic() - self._transition_started) / duration
        return progress if progress < 1 else None

    def _end_transition(self) -> None:
        """Drop the outgoing photo and any blend memoised for it."""
        self._prev_image_bytes = None
        self._transition_started = None
        self._blend_cache = None

    async def _async_blended_frame(self) -> bytes | None:
        """Return the current crossfade frame, or ``None`` if not fading.

        Progress is quantised into ``CROSSFADE_STEPS`` buckets and the most
        recent blend is memoised, so several clients polling within the same
        bucket share one composite instead of each paying for a fresh one.
        """
        progress = self._transition_progress()
        if progress is None:
            self._end_transition()
            return None

        outgoing = self._prev_image_bytes
        incoming = self._current_image_bytes
        if outgoing is None or incoming is None:
            return None

        step = round(progress * CROSSFADE_STEPS)
        if step <= 0:
            return outgoing

        if self._blend_cache is not None and self._blend_cache[0] == step:
            return self._blend_cache[1]

        try:
            blended = await self.hass.async_add_executor_job(
                self._compose_blend, outgoing, incoming, step / CROSSFADE_STEPS
            )
        except Exception as err:  # pylint: disable=broad-except
            _LOGGER.debug("Crossfade blend failed: %s", err)
            self._end_transition()
            return None

        self._blend_cache = (step, blended)
        return blended

    async def _async_rotate(self, _now=None) -> None:
        """Advance to the next photo in the list.

        When crossfade is enabled the outgoing photo is kept alongside the new
        one and a timer is started; the blending itself happens lazily in
        :meth:`async_camera_image`, so rotation never sleeps and the timing of
        the dissolve is decoupled from the rotation schedule.
        """
        assets = self._coordinator.data
        if not assets:
            return

        new_index = (self._current_index + 1) % len(assets)
        outgoing = self._current_image_bytes
        next_bytes = (
            self._next_image_bytes if self._next_index == new_index else None
        )

        # Promote the prefetched next image if it matches; otherwise fetch it.
        self._current_index = new_index
        if next_bytes is not None:
            self._current_image_bytes = next_bytes
        else:
            await self._load_current_image()

        crossfade_enabled, crossfade_duration = self._crossfade_settings()
        incoming = self._current_image_bytes
        if (
            crossfade_enabled
            and crossfade_duration > 0
            and outgoing is not None
            and incoming is not None
            and outgoing is not incoming
        ):
            self._prev_image_bytes = outgoing
            self._transition_started = monotonic()
            self._blend_cache = None
        else:
            self._end_transition()

        # The promoted bytes are now the current image; clear the next slot
        # and prefetch a fresh one for the upcoming rotation.
        self._next_index = None
        self._next_image_bytes = None
        self.async_write_ha_state()
        self.hass.async_create_task(self._load_next_image())

    async def _prune_cache(self, keep: int) -> None:
        """Delete slot files whose index is >= the current asset count."""
        def _delete_excess() -> None:
            for f in self._cache_dir.glob("*.jpg"):
                try:
                    if int(f.stem) >= keep:
                        f.unlink()
                except (ValueError, OSError):
                    pass

        await self.hass.async_add_executor_job(_delete_excess)

    async def _fetch_single_thumbnail(self, asset_id: str) -> bytes | None:
        """Fetch a single thumbnail from Immich, returning raw bytes or None."""
        url = (
            f"{self._coordinator.host}/api/assets/{asset_id}/thumbnail"
            "?size=preview&edited=true"
        )
        session = async_get_clientsession(self.hass)
        async with session.get(
            url,
            headers={"x-api-key": self._coordinator.api_key},
            timeout=15,
        ) as resp:
            if resp.status == 200:
                return await resp.read()
            _LOGGER.warning(
                "Immich returned HTTP %s for asset thumbnail %s",
                resp.status,
                asset_id,
            )
            return None

    @staticmethod
    def _compose_blend(a: bytes, b: bytes, alpha: float) -> bytes:
        """Blend two JPEG images, *alpha* being the weight given to *b*.

        The two frames need not share a shape: with mixed orientations in the
        pool a portrait photo can fade into a landscape one, so *b* is fitted
        into *a*'s frame on black rather than stretched to it.
        """
        img_a = Image.open(io.BytesIO(a)).convert("RGB")
        img_b = Image.open(io.BytesIO(b)).convert("RGB")
        if img_a.size != img_b.size:
            img_b = ImageOps.pad(img_b, img_a.size, method=Image.LANCZOS)
        blended = Image.blend(img_a, img_b, alpha)
        buf = io.BytesIO()
        blended.save(buf, format="JPEG", quality=85)
        return buf.getvalue()

    @staticmethod
    def _compose_pair(first_bytes: bytes, second_bytes: bytes, axis: str) -> bytes:
        """Stitch two images into one composite.

        Portrait photos are placed side-by-side to fill a landscape card;
        landscape photos are stacked to fill a portrait one.
        """
        first = Image.open(io.BytesIO(first_bytes))
        second = Image.open(io.BytesIO(second_bytes))

        if axis == AXIS_VERTICAL:
            # Scale both to the same width (use the smaller width) and stack
            target_w = min(first.width, second.width)
            if first.width != target_w:
                first = first.resize(
                    (target_w, round(first.height * target_w / first.width)),
                    Image.LANCZOS,
                )
            if second.width != target_w:
                second = second.resize(
                    (target_w, round(second.height * target_w / second.width)),
                    Image.LANCZOS,
                )
            combined = Image.new("RGB", (target_w, first.height + second.height))
            combined.paste(first, (0, 0))
            combined.paste(second, (0, first.height))
        else:
            # Scale both to the same height (use the smaller height)
            target_h = min(first.height, second.height)
            if first.height != target_h:
                first = first.resize(
                    (round(first.width * target_h / first.height), target_h),
                    Image.LANCZOS,
                )
            if second.height != target_h:
                second = second.resize(
                    (round(second.width * target_h / second.height), target_h),
                    Image.LANCZOS,
                )
            combined = Image.new("RGB", (first.width + second.width, target_h))
            combined.paste(first, (0, 0))
            combined.paste(second, (first.width, 0))

        buf = io.BytesIO()
        combined.save(buf, format="JPEG", quality=85)
        return buf.getvalue()

    async def _fetch_image_for_index(self, idx: int) -> bytes | None:
        """Fetch image bytes for the asset at *idx* and write through to cache.

        Falls back to reading the on-disk cache file for *idx* if Immich is
        unreachable.  Returns ``None`` if neither network nor cache yielded
        any bytes (in which case the caller should leave its buffer
        unchanged).
        """
        assets = self._coordinator.data
        if not assets:
            return None
        if not 0 <= idx < len(assets):
            return None

        asset = assets[idx]
        asset_id = asset.get("id")
        if not asset_id:
            return None

        cache_file = (
            self._cache_dir / f"{idx}.jpg" if self._cache_dir is not None else None
        )

        try:
            if asset.get("is_pair"):
                left_id = asset["left"]["id"]
                right_id = asset["right"]["id"]
                left_bytes = await self._fetch_single_thumbnail(left_id)
                right_bytes = await self._fetch_single_thumbnail(right_id)

                if left_bytes and right_bytes:
                    data = await self.hass.async_add_executor_job(
                        self._compose_pair,
                        left_bytes,
                        right_bytes,
                        asset.get("pair_axis"),
                    )
                    if cache_file is not None:
                        await self.hass.async_add_executor_job(
                            cache_file.write_bytes, data
                        )
                    return data

                _LOGGER.warning(
                    "Could not fetch both thumbnails for pair %s",
                    asset_id,
                )
                return await self._read_cache_bytes(cache_file)

            data = await self._fetch_single_thumbnail(asset_id)
            if data:
                if cache_file is not None:
                    await self.hass.async_add_executor_job(
                        cache_file.write_bytes, data
                    )
                return data
            return await self._read_cache_bytes(cache_file)
        except Exception as err:  # pylint: disable=broad-except
            _LOGGER.debug("Error fetching Immich thumbnail for %s: %s", asset_id, err)
            return await self._read_cache_bytes(cache_file)

    async def _load_current_image(self) -> None:
        """Fetch image bytes for the current asset and store in the buffer."""
        assets = self._coordinator.data
        if not assets:
            return

        idx = min(self._current_index, len(assets) - 1)
        data = await self._fetch_image_for_index(idx)
        if data is not None:
            self._current_image_bytes = data

    async def _load_next_image(self) -> None:
        """Prefetch the image for the upcoming rotation into the next buffer."""
        assets = self._coordinator.data
        if not assets:
            return

        next_idx = (self._current_index + 1) % len(assets)
        data = await self._fetch_image_for_index(next_idx)
        if data is None:
            return

        # A rotation or a coordinator refresh may have moved on while we were
        # fetching; only publish the buffer if it is still the image the next
        # rotation actually wants.
        assets = self._coordinator.data
        if not assets or (self._current_index + 1) % len(assets) != next_idx:
            return

        self._next_index = next_idx
        self._next_image_bytes = data

    async def _restore_startup_image_from_cache(self) -> None:
        """Restore the first available cached image during Home Assistant startup."""
        if self._cache_dir is None or self._current_image_bytes is not None:
            return

        cache_file = await self.hass.async_add_executor_job(
            self._find_first_cached_image
        )
        if cache_file is not None:
            await self._serve_from_cache(cache_file)

    def _find_first_cached_image(self) -> pathlib.Path | None:
        """Return the lowest-numbered cached slot file, if any exists."""
        if self._cache_dir is None:
            return None

        candidates: list[tuple[int, pathlib.Path]] = []
        for cache_file in self._cache_dir.glob("*.jpg"):
            try:
                candidates.append((int(cache_file.stem), cache_file))
            except ValueError:
                continue

        if not candidates:
            return None

        candidates.sort(key=lambda item: item[0])
        return candidates[0][1]

    async def _read_cache_bytes(
        self, cache_file: pathlib.Path | None
    ) -> bytes | None:
        """Return the cached bytes for *cache_file*, or ``None`` if absent."""
        if cache_file is None:
            return None
        try:
            data = await self.hass.async_add_executor_job(cache_file.read_bytes)
            _LOGGER.debug("Serving cached image: %s", cache_file.name)
            return data
        except FileNotFoundError:
            return None
        except OSError as err:
            _LOGGER.debug("Could not read cache file %s: %s", cache_file, err)
            return None

    async def _serve_from_cache(self, cache_file: pathlib.Path | None) -> None:
        """Load image bytes from the on-disk cache into the current buffer."""
        data = await self._read_cache_bytes(cache_file)
        if data is not None:
            self._current_image_bytes = data
