"""Config flow for the Immich integration."""

from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant import config_entries
from homeassistant.core import callback
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.selector import (
    NumberSelector,
    NumberSelectorConfig,
    NumberSelectorMode,
    SelectOptionDict,
    SelectSelector,
    SelectSelectorConfig,
    TextSelector,
    TextSelectorConfig,
    TextSelectorType,
)

from .const import (
    CONF_ALBUM_ID,
    CONF_API_ENDPOINT,
    CONF_API_PARAMS,
    CONF_API_KEY,
    CONF_ASSET_COUNT,
    CONF_HOST,
    CONF_ROTATION_INTERVAL,
    CONF_SCAN_INTERVAL,
    DEFAULT_ASSET_COUNT,
    DEFAULT_ROTATION_INTERVAL,
    DEFAULT_SCAN_INTERVAL,
    DOMAIN,
    ENDPOINT_ALBUM,
    ENDPOINT_ALL,
    ENDPOINT_FAVORITES,
    ENDPOINT_RANDOM,
    ENDPOINT_SEARCH,
    API_ENDPOINTS,
)

_LOGGER = logging.getLogger(__name__)


def _number_selector(min_val: int, max_val: int, step: int = 1) -> NumberSelector:
    return NumberSelector(
        NumberSelectorConfig(
            min=min_val,
            max=max_val,
            step=step,
            mode=NumberSelectorMode.BOX,
        )
    )


class ImmichConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle the Immich config flow."""

    VERSION = 1

    def __init__(self) -> None:
        """Initialise flow state."""
        self._host: str = ""
        self._api_key: str = ""
        self._endpoint: str = ""
        self._albums: list[dict[str, Any]] = []
        self._collected: dict[str, Any] = {}

    # ------------------------------------------------------------------
    # Step 1 – host + API key
    # ------------------------------------------------------------------

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.FlowResult:
        """Ask for the Immich host and API key then validate connectivity."""
        errors: dict[str, str] = {}

        if user_input is not None:
            host = user_input[CONF_HOST].rstrip("/")
            api_key = user_input[CONF_API_KEY]

            error = await self._test_credentials(host, api_key)
            if error:
                errors["base"] = error
            else:
                self._host = host
                self._api_key = api_key
                return await self.async_step_endpoint()

        # Pre-populate from an existing entry so the user doesn't have to
        # re-type the same host/key when adding a second endpoint.
        existing = self.hass.config_entries.async_entries(DOMAIN)
        prev = existing[0].data if existing else {}
        suggested_host = prev.get(CONF_HOST, "http://192.168.1.100:2283")
        suggested_key = prev.get(CONF_API_KEY, "")

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        CONF_HOST,
                        description={"suggested_value": suggested_host},
                    ): TextSelector(
                        TextSelectorConfig(type=TextSelectorType.URL)
                    ),
                    vol.Required(
                        CONF_API_KEY,
                        description={"suggested_value": suggested_key},
                    ): TextSelector(
                        TextSelectorConfig(type=TextSelectorType.PASSWORD)
                    ),
                }
            ),
            errors=errors,
        )

    # ------------------------------------------------------------------
    # Step 2 – choose API endpoint
    # ------------------------------------------------------------------

    async def async_step_endpoint(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.FlowResult:
        """Let the user pick which Immich API endpoint to query."""
        if user_input is not None:
            self._endpoint = user_input[CONF_API_ENDPOINT]
            self._collected = {}

            if self._endpoint == ENDPOINT_RANDOM:
                return await self.async_step_random_params()
            if self._endpoint == ENDPOINT_ALL:
                return await self.async_step_all_params()
            if self._endpoint == ENDPOINT_ALBUM:
                return await self.async_step_album_params()
            if self._endpoint == ENDPOINT_FAVORITES:
                return await self.async_step_favorites_params()
            if self._endpoint == ENDPOINT_SEARCH:
                return await self.async_step_search_params()

        return self.async_show_form(
            step_id="endpoint",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_API_ENDPOINT): SelectSelector(
                        SelectSelectorConfig(
                            options=[
                                SelectOptionDict(value=k, label=v)
                                for k, v in API_ENDPOINTS.items()
                            ]
                        )
                    )
                }
            ),
        )

    # ------------------------------------------------------------------
    # Step 3a – Random Assets params
    # ------------------------------------------------------------------

    async def async_step_random_params(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.FlowResult:
        """Configure random asset count and optional JSON filters."""
        import json

        errors: dict[str, str] = {}

        if user_input is not None:
            raw = user_input.get("random_query", "{}").strip() or "{}"
            try:
                params = json.loads(raw)
                if not isinstance(params, dict):
                    raise ValueError("Must be a JSON object")
            except (ValueError, TypeError):
                errors["random_query"] = "invalid_json"
            else:
                self._collected[CONF_ASSET_COUNT] = int(user_input[CONF_ASSET_COUNT])
                self._collected[CONF_API_PARAMS] = params
                return await self.async_step_intervals()

        return self.async_show_form(
            step_id="random_params",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        CONF_ASSET_COUNT, default=DEFAULT_ASSET_COUNT
                    ): _number_selector(1, 500),
                    vol.Optional("random_query", default="{}"): TextSelector(
                        TextSelectorConfig(multiline=True)
                    ),
                }
            ),
            description_placeholders={
                "example": '{"personIds": ["uuid1", "uuid2"]}',
                "docs_url": "https://api.immich.app/endpoints/search/searchRandom",
            },
            errors=errors,
        )

    # ------------------------------------------------------------------
    # Step 3b – All Assets params
    # ------------------------------------------------------------------

    async def async_step_all_params(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.FlowResult:
        """Configure filters for the 'All Assets' endpoint."""
        if user_input is not None:
            self._collected[CONF_ASSET_COUNT] = int(user_input[CONF_ASSET_COUNT])
            extra: dict[str, Any] = {}
            if user_input.get("order"):
                extra["order"] = user_input["order"]
            self._collected[CONF_API_PARAMS] = extra
            return await self.async_step_intervals()

        return self.async_show_form(
            step_id="all_params",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        CONF_ASSET_COUNT, default=DEFAULT_ASSET_COUNT
                    ): _number_selector(1, 500),
                    vol.Optional("order", default="desc"): SelectSelector(
                        SelectSelectorConfig(
                            options=[
                                SelectOptionDict(value="desc", label="Newest first"),
                                SelectOptionDict(value="asc", label="Oldest first"),
                            ]
                        )
                    ),
                }
            ),
        )

    # ------------------------------------------------------------------
    # Step 3c – Album Assets params
    # ------------------------------------------------------------------

    async def async_step_album_params(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.FlowResult:
        """Let the user select an album (fetched live from the API)."""
        errors: dict[str, str] = {}

        if not self._albums:
            try:
                self._albums = await self._fetch_albums()
            except Exception:
                errors["base"] = "cannot_fetch_albums"

        if user_input is not None and not errors:
            self._collected[CONF_ALBUM_ID] = user_input[CONF_ALBUM_ID]
            self._collected[CONF_ASSET_COUNT] = int(user_input[CONF_ASSET_COUNT])
            return await self.async_step_intervals()

        album_options = [
            SelectOptionDict(
                value=album["id"],
                label=f"{album['albumName']} ({album.get('assetCount', '?')} assets)",
            )
            for album in self._albums
        ]

        if not album_options:
            album_options = [SelectOptionDict(value="", label="No albums found")]

        return self.async_show_form(
            step_id="album_params",
            data_schema=vol.Schema(
                {
                    vol.Required(CONF_ALBUM_ID): SelectSelector(
                        SelectSelectorConfig(options=album_options)
                    ),
                    vol.Required(
                        CONF_ASSET_COUNT, default=DEFAULT_ASSET_COUNT
                    ): _number_selector(1, 500),
                }
            ),
            errors=errors,
        )

    # ------------------------------------------------------------------
    # Step 3d – Favorite Assets params
    # ------------------------------------------------------------------

    async def async_step_favorites_params(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.FlowResult:
        """Configure the number of favorite assets to fetch each refresh."""
        if user_input is not None:
            self._collected[CONF_ASSET_COUNT] = int(user_input[CONF_ASSET_COUNT])
            return await self.async_step_intervals()

        return self.async_show_form(
            step_id="favorites_params",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        CONF_ASSET_COUNT, default=DEFAULT_ASSET_COUNT
                    ): _number_selector(1, 500),
                }
            ),
        )

    # ------------------------------------------------------------------
    # Step 3e – Search Metadata params
    # ------------------------------------------------------------------

    async def async_step_search_params(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.FlowResult:
        """Configure metadata search filters (JSON object)."""
        errors: dict[str, str] = {}

        if user_input is not None:
            import json

            raw = user_input.get("search_query", "{}").strip() or "{}"
            try:
                params = json.loads(raw)
                if not isinstance(params, dict):
                    raise ValueError("Must be a JSON object")
            except (ValueError, TypeError):
                errors["search_query"] = "invalid_json"
            else:
                self._collected[CONF_ASSET_COUNT] = int(user_input[CONF_ASSET_COUNT])
                self._collected[CONF_API_PARAMS] = params
                return await self.async_step_intervals()

        return self.async_show_form(
            step_id="search_params",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        CONF_ASSET_COUNT, default=DEFAULT_ASSET_COUNT
                    ): _number_selector(1, 500),
                    vol.Optional("search_query", default="{}"): TextSelector(
                        TextSelectorConfig(multiline=True)
                    ),
                }
            ),
            description_placeholders={
                "example": '{"city": "Paris", "isFavorite": true, "type": "IMAGE"}',
                "docs_url": "https://api.immich.app/endpoints/search/searchAssets",
            },
            errors=errors,
        )

    # ------------------------------------------------------------------
    # Step 4 – timing / intervals
    # ------------------------------------------------------------------

    async def async_step_intervals(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.FlowResult:
        """Ask how often to rotate images and refresh asset data."""
        if user_input is not None:
            data = {
                CONF_HOST: self._host,
                CONF_API_KEY: self._api_key,
                CONF_API_ENDPOINT: self._endpoint,
                CONF_ROTATION_INTERVAL: int(user_input[CONF_ROTATION_INTERVAL]),
                CONF_SCAN_INTERVAL: int(user_input[CONF_SCAN_INTERVAL]),
                **self._collected,
            }
            title = API_ENDPOINTS.get(self._endpoint, "Immich")
            return self.async_create_entry(title=title, data=data)

        return self.async_show_form(
            step_id="intervals",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        CONF_ROTATION_INTERVAL, default=DEFAULT_ROTATION_INTERVAL
                    ): _number_selector(5, 3600),
                    vol.Required(
                        CONF_SCAN_INTERVAL, default=DEFAULT_SCAN_INTERVAL
                    ): _number_selector(60, 86400),
                }
            ),
        )

    # ------------------------------------------------------------------
    # Options flow entry point
    # ------------------------------------------------------------------

    @staticmethod
    @callback
    def async_get_options_flow(
        config_entry: config_entries.ConfigEntry,
    ) -> ImmichOptionsFlowHandler:
        """Return the options flow handler."""
        return ImmichOptionsFlowHandler(config_entry)

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    async def _test_credentials(self, host: str, api_key: str) -> str | None:
        """Return an error key string, or None on success."""
        session = async_get_clientsession(self.hass)
        try:
            async with session.get(
                f"{host}/api/server/ping",
                headers={"x-api-key": api_key},
                timeout=10,
            ) as resp:
                if resp.status == 401:
                    return "invalid_auth"
                if resp.status not in (200, 204):
                    return "cannot_connect"
        except Exception:
            return "cannot_connect"
        return None

    async def _fetch_albums(self) -> list[dict[str, Any]]:
        """Fetch the list of albums from the Immich API."""
        session = async_get_clientsession(self.hass)
        async with session.get(
            f"{self._host}/api/albums",
            headers={"x-api-key": self._api_key, "Accept": "application/json"},
            timeout=10,
        ) as resp:
            resp.raise_for_status()
            return await resp.json()


# ---------------------------------------------------------------------------
# Options flow – allows changing rotation / scan intervals after initial setup
# ---------------------------------------------------------------------------


class ImmichOptionsFlowHandler(config_entries.OptionsFlow):
    """Handle Immich options (editable after initial setup)."""

    def __init__(self, config_entry: config_entries.ConfigEntry) -> None:
        """Initialise."""
        self._config_entry = config_entry

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.FlowResult:
        """Show the options form."""
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        current = self._config_entry.options or self._config_entry.data

        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(
                {
                    vol.Required(
                        CONF_ROTATION_INTERVAL,
                        default=current.get(
                            CONF_ROTATION_INTERVAL, DEFAULT_ROTATION_INTERVAL
                        ),
                    ): _number_selector(5, 3600),
                    vol.Required(
                        CONF_SCAN_INTERVAL,
                        default=current.get(CONF_SCAN_INTERVAL, DEFAULT_SCAN_INTERVAL),
                    ): _number_selector(60, 86400),
                    vol.Required(
                        CONF_ASSET_COUNT,
                        default=current.get(CONF_ASSET_COUNT, DEFAULT_ASSET_COUNT),
                    ): _number_selector(1, 500),
                }
            ),
        )
