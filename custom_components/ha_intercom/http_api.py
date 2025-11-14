import asyncio
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from aiohttp import web, ClientSession, WSMsgType
from .const import DOMAIN, CONF_SERVICE_URL


async def async_register_proxy(hass: HomeAssistant, entry: ConfigEntry):
    """Register a proxy route that forwards all HTTP methods to the configured HA Intercom service."""

    async def authenticate(request: web.Request):
        # Already authenticated by HA middleware
        hass_user = request.get("hass_user")
        if hass_user:
            return hass_user

        # Fallback: token in query param
        token = request.query.get("token")
        if not token:
            return None

        # Validate using HA token validation (sync in your version)
        refresh_token = hass.auth.async_validate_access_token(token)
        if refresh_token is None:
            return None

        # Return user from token
        return refresh_token.user

    # ----------------------------
    # WEBSOCKET PROXY
    # ----------------------------
    async def websocket_proxy(request: web.Request):
        """Proxy WebSocket connections to the backend MediaMTX service."""

        # --- 1. Validate auth ---
        user = await authenticate(request)
        if user is None:
            return web.Response(status=401, text="Unauthorized")

        # --- 2. Build backend WebSocket URL with querystring preserved ---
        entry_data = hass.data[DOMAIN].get(entry.entry_id)
        base_url = entry_data[CONF_SERVICE_URL].rstrip("/")

        # convert http(s) to ws(s)
        if base_url.startswith("https://"):
            ws_base_url = base_url.replace("https://", "wss://", 1)
        elif base_url.startswith("http://"):
            ws_base_url = base_url.replace("http://", "ws://", 1)
        else:
            ws_base_url = base_url  # assume user entered ws:// or wss://

        target_url = f"{ws_base_url}/api/ha_intercom/ws"

        # --- 3. Prepare outgoing WebSocket to client ---
        ws_client = web.WebSocketResponse()
        await ws_client.prepare(request)

        # --- 4. Connect to backend WebSocket ---
        try:
            async with ClientSession() as session:
                try:
                    ws_server = await session.ws_connect(target_url)
                except Exception:
                    await ws_client.close(
                        code=1011,
                        message=b"Backend WebSocket connection failed",
                    )
                    return ws_client

                async def client_to_server():
                    async for msg in ws_client:
                        if msg.type == web.WSMsgType.TEXT:
                            await ws_server.send_str(msg.data)
                        elif msg.type == web.WSMsgType.BINARY:
                            await ws_server.send_bytes(msg.data)
                        elif msg.type in (web.WSMsgType.CLOSE, web.WSMsgType.ERROR):
                            await ws_server.close()
                            break

                async def server_to_client():
                    async for msg in ws_server:
                        if msg.type == web.WSMsgType.TEXT:
                            await ws_client.send_str(msg.data)
                        elif msg.type == web.WSMsgType.BINARY:
                            await ws_client.send_bytes(msg.data)
                        elif msg.type in (web.WSMsgType.CLOSE, web.WSMsgType.ERROR):
                            await ws_client.close()
                            break

                # --- 5. Proxy in both directions until one ends ---
                await asyncio.gather(
                    client_to_server(),
                    server_to_client(),
                )

                # --- 6. Graceful cleanup ---
                if not ws_client.closed:
                    await ws_client.close()
                if not ws_server.closed:
                    await ws_server.close()

                return ws_client

        except Exception:
            await ws_client.close(
                code=1011,
                message=b"Unhandled WebSocket proxy error",
            )
            return ws_client

    # ----------------------------
    # MAIN PROXY HANDLER
    # ----------------------------

    async def handle_proxy(request: web.Request):
        """Forward any request (including OPTIONS) to the configured service URL."""

        # Authenticate user
        hass_user = await authenticate(request)
        if hass_user is None:
            return web.json_response({"error": "Unauthorized"}, status=401)

        # Retrieve the configured service URL
        entry_data = hass.data[DOMAIN].get(entry.entry_id)
        if not entry_data:
            return web.json_response(
                {"error": "Integration not properly initialized"}, status=500
            )

        base_url = entry_data[CONF_SERVICE_URL].rstrip("/")
        tail = request.match_info.get("tail", "")
        target_url = f"{base_url}/api/ha_intercom/{tail}".rstrip("/")

        # Copy query parameters
        params = dict(request.query)

        # Forward only the headers we care about
        headers = {
            k: v
            for k, v in request.headers.items()
            if k in ("Authorization", "Content-Type")
        }

        # Read request body, if any
        try:
            body = await request.read()
        except Exception:
            body = None

        # Proxy the request to the backend service
        async with ClientSession() as session:
            async with session.request(
                method=request.method,
                url=target_url,
                headers=headers,
                params=params,
                data=body,
            ) as resp:
                response_body = await resp.read()

                # Forward most headers except hop-by-hop or CORS-related
                response_headers = {
                    k: v
                    for k, v in dict(resp.headers).items()
                    if k.lower() not in ("transfer-encoding",)
                }

                return web.Response(
                    body=response_body,
                    status=resp.status,
                    headers=response_headers,
                )

    # Register the route manually (wildcard = all methods)
    hass.http.app.router.add_route("GET", "/api/ha_intercom/ws", websocket_proxy)
    hass.http.app.router.add_route("*", "/api/ha_intercom/{tail:.*}", handle_proxy)
