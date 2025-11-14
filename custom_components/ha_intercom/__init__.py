from homeassistant.core import HomeAssistant
from homeassistant.config_entries import ConfigEntry

from .const import DOMAIN, CONF_SERVICE_URL

from .http_api import async_register_proxy
from . import utils
from pathlib import Path

import logging

_LOGGER = logging.getLogger(__name__)


async def async_setup(hass: HomeAssistant, config: dict):
    """YAML setup (not used but must exist)."""
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry):
    """Set up from a config entry."""
    entry_data = entry.data

    hass.data.setdefault(DOMAIN, {})
    hass.data[DOMAIN][entry.entry_id] = {CONF_SERVICE_URL: entry_data[CONF_SERVICE_URL]}

    # Register backend API
    await async_register_proxy(hass, entry)

    # Serve JS card from www directory inside custom_component
    path = Path(__file__).parent / "www"
    await utils.register_static_path(hass, f"/{DOMAIN}", str(path))

    # Register Lovelace resource
    version = getattr(hass.data.get("integrations", {}).get(DOMAIN), "version", "0")
    await utils.init_resource(hass, f"/{DOMAIN}/ha-intercom-card.js", str(version))

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry):
    """Unload Integration."""
    hass.data[DOMAIN].pop(entry.entry_id, None)
    return True
