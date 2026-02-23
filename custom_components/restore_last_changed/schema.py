"""Config schema for the Restore Last Changed integration."""

import homeassistant.helpers.config_validation as cv
import voluptuous as vol

from .const import CONF_ENTITIES, DOMAIN

CONFIG_SCHEMA = vol.Schema(
    {
        DOMAIN: vol.Schema(
            {
                vol.Required(CONF_ENTITIES): vol.All(
                    cv.ensure_list, [cv.entity_id]
                ),
            }
        )
    },
    extra=vol.ALLOW_EXTRA,
)
