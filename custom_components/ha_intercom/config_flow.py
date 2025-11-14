from __future__ import annotations

import voluptuous as vol
from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResult
from homeassistant.helpers import config_validation as cv

from .const import DOMAIN, CONF_SERVICE_URL


class HaIntercomConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle a config flow for HA Intercom."""

    VERSION = 1

    async def async_step_user(self, user_input: dict | None = None) -> FlowResult:
        """Handle the initial step when adding the integration."""
        errors: dict[str, str] = {}

        if user_input is not None:
            full_url = user_input[CONF_SERVICE_URL].strip()

            # Basic validation: must start with http:// or https://
            if not full_url.startswith(("http://", "https://")):
                errors["base"] = "invalid_url"
            else:
                # Create a unique ID based on the URL
                await self.async_set_unique_id(full_url)
                self._abort_if_unique_id_configured()

                return self.async_create_entry(
                    title=full_url,
                    data=user_input,
                )  # type: ignore[arg-type]

        schema = vol.Schema(
            {
                vol.Required(
                    CONF_SERVICE_URL,
                    default="http://localhost:3001",
                ): cv.string
            }
        )

        return self.async_show_form(
            step_id="user",
            data_schema=schema,
            errors=errors,
        )  # type: ignore[arg-type]
