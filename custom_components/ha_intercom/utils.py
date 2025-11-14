import logging

_LOGGER = logging.getLogger(__name__)


async def register_static_path(hass, url_path: str, directory_path: str):
    """Register a static directory for serving files."""
    app = hass.http.app

    # Check if this path is already registered
    for route in app.router.routes():
        if getattr(route, "path", None) == url_path:
            return

    app.router.add_static(url_path, directory_path, show_index=False)
    _LOGGER.debug("Registered static directory: %s -> %s", url_path, directory_path)


async def init_resource(hass, url_path: str, version: str):
    """Auto-register a Lovelace resource (JS module) via frontend integration."""
    try:
        # Home Assistant provides this helper to ensure resources are tracked properly
        from homeassistant.components.frontend import async_register_built_in_panel
        from homeassistant.components.frontend import add_extra_js_url

        # This is the simpler, version-safe way to tell HA about your JS module
        add_extra_js_url(hass, url_path)
        _LOGGER.info("Added Lovelace JS resource: %s (v%s)", url_path, version)
    except Exception as err:
        _LOGGER.warning("Unable to auto-register Lovelace resource: %s", err)
