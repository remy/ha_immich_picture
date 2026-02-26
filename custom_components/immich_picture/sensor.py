"""Sensor platform for Immich – diagnostic entities."""

from __future__ import annotations

import pathlib

from homeassistant.components.sensor import SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EntityCategory
from homeassistant.core import HomeAssistant
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .coordinator import ImmichDataUpdateCoordinator


async def async_setup_entry(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Set up the Immich diagnostic sensor from a config entry."""
    coordinator: ImmichDataUpdateCoordinator = hass.data[DOMAIN][config_entry.entry_id]
    async_add_entities([ImmichCachePathSensor(hass, coordinator, config_entry)])


class ImmichCachePathSensor(SensorEntity):
    """Diagnostic sensor that exposes the on-disk image cache directory path."""

    _attr_has_entity_name = True
    _attr_entity_category = EntityCategory.DIAGNOSTIC
    _attr_icon = "mdi:folder-image"
    _attr_translation_key = "cache_path"

    def __init__(
        self,
        hass: HomeAssistant,
        coordinator: ImmichDataUpdateCoordinator,
        config_entry: ConfigEntry,
    ) -> None:
        """Initialise the sensor."""
        cache_path = pathlib.Path(
            hass.config.path(DOMAIN, "image_cache", config_entry.entry_id)
        )
        self._attr_native_value = str(cache_path)
        self._attr_unique_id = f"{config_entry.entry_id}_cache_path"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, config_entry.entry_id)},
            name="Immich Picture",
            manufacturer="Immich",
            model="Photo Server",
            configuration_url=coordinator.host,
        )
