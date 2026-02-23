"""Restore accurate last_changed / last_updated timestamps on HA startup.

Configuration example (configuration.yaml):

    restore_last_changed:
      entities:
        - sensor.my_sensor
        - binary_sensor.front_door
"""

import asyncio
import logging

from homeassistant.components import recorder
from homeassistant.components.recorder import history
from homeassistant.core import Event, HomeAssistant
from homeassistant.helpers.typing import ConfigType

from .const import CONF_ENTITIES, DOMAIN, STARTUP_DELAY
from .schema import CONFIG_SCHEMA  # noqa: F401 – HA reads this from the module

_LOGGER = logging.getLogger(__name__)

# Re-export so HA can discover the schema on import.
__all__ = ["CONFIG_SCHEMA", "async_setup"]


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Set up the restore_last_changed integration."""

    domain_config = config.get(DOMAIN)
    if not domain_config:
        return True

    entity_ids: list[str] = domain_config.get(CONF_ENTITIES, [])
    if not entity_ids:
        _LOGGER.debug("No entities configured, nothing to restore.")
        return True

    async def _restore_timestamps(_event: Event) -> None:
        """Run after HA is fully started."""
        # Give entity platforms and the recorder time to finish their own
        # startup tasks before we query.
        await asyncio.sleep(STARTUP_DELAY)

        try:
            recorder_instance = recorder.get_instance(hass)
        except Exception:  # pylint: disable=broad-except
            _LOGGER.warning(
                "Recorder instance not available; skipping last_changed restore."
            )
            return

        for entity_id in entity_ids:
            try:
                await _restore_entity(hass, recorder_instance, entity_id)
            except Exception:  # pylint: disable=broad-except
                _LOGGER.exception(
                    "Unexpected error restoring timestamps for %s", entity_id
                )

    hass.bus.async_listen_once(
        "homeassistant_started",  # EVENT_HOMEASSISTANT_STARTED value
        _restore_timestamps,
    )

    return True


async def _restore_entity(
    hass: HomeAssistant,
    recorder_instance: recorder.Recorder,
    entity_id: str,
) -> None:
    """Restore last_changed / last_updated for a single entity."""

    # Skip entities that don't currently exist in the state machine – we must
    # not create phantom states for entities whose platform hasn't loaded yet
    # or that simply aren't configured.
    current_state = hass.states.get(entity_id)
    if current_state is None:
        _LOGGER.debug(
            "Entity %s not found in state machine, skipping restore.", entity_id
        )
        return

    # get_last_state_changes returns a dict[entity_id, list[State]].
    # We ask for the 1 most-recent change.
    history_result: dict = await hass.async_add_executor_job(
        _fetch_last_state, hass, entity_id
    )

    states = history_result.get(entity_id)
    if not states:
        _LOGGER.debug("No history found for %s, skipping restore.", entity_id)
        return

    last_state = states[-1]

    _LOGGER.info(
        "Restoring timestamps for %s: last_changed=%s, last_updated=%s",
        entity_id,
        last_state.last_changed,
        last_state.last_updated,
    )

    hass.states.async_set(
        entity_id,
        last_state.state,
        last_state.attributes,
        last_changed=last_state.last_changed,
        last_updated=last_state.last_updated,
    )


def _fetch_last_state(hass: HomeAssistant, entity_id: str) -> dict:
    """Blocking helper – must be called via async_add_executor_job."""
    try:
        return history.get_last_state_changes(hass, 1, entity_id)
    except Exception:  # pylint: disable=broad-except
        _LOGGER.warning(
            "Failed to query recorder history for %s.", entity_id, exc_info=True
        )
        return {}
