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

        # --- 1. Validate auth first ---
        user = await authenticate(request)
        if user is None:
            return web.Response(status=401, text="Unauthorized")

        # --- 2. Build backend WebSocket URL ---
        entry_data = hass.data[DOMAIN].get(entry.entry_id)
        base_url = entry_data[CONF_SERVICE_URL].rstrip("/")
        target_url = f"{base_url}/api/ha_intercom/ws"

        # --- 3. Outgoing websocket to client ---
        ws_client = web.WebSocketResponse()
        await ws_client.prepare(request)

        # --- 4. Try connecting to backend WebSocket ---
        try:
            async with ClientSession() as session:
                try:
                    ws_server = await session.ws_connect(target_url)
                except Exception:
                    await ws_client.close(
                        code=1011, message=b"Backend WebSocket connection failed"
                    )
                    return ws_client

                #
                # --- PATCH 1: Proper bidirectional forwarding including ping/pong ---
                #
                async def client_to_server():
                    try:
                        async for msg in ws_client:
                            if msg.type == web.WSMsgType.TEXT:
                                await ws_server.send_str(msg.data)
                            elif msg.type == web.WSMsgType.BINARY:
                                await ws_server.send_bytes(msg.data)
                            elif msg.type == web.WSMsgType.PING:
                                await ws_server.ping()
                            elif msg.type == web.WSMsgType.PONG:
                                await ws_server.pong()
                            elif msg.type == web.WSMsgType.CLOSE:
                                await ws_server.close()
                    except Exception:
                        # websocket loop ends
                        pass

                async def server_to_client():
                    try:
                        async for msg in ws_server:
                            if msg.type == web.WSMsgType.TEXT:
                                await ws_client.send_str(msg.data)
                            elif msg.type == web.WSMsgType.BINARY:
                                await ws_client.send_bytes(msg.data)
                            elif msg.type == web.WSMsgType.PING:
                                await ws_client.ping()
                            elif msg.type == web.WSMsgType.PONG:
                                await ws_client.pong()
                            elif msg.type == web.WSMsgType.CLOSE:
                                await ws_client.close()
                    except Exception:
                        # backend closed or error
                        pass

                #
                # --- PATCH 2: Run both tasks safely ---
                #
                task_client = asyncio.create_task(client_to_server())
                task_server = asyncio.create_task(server_to_client())

                done, pending = await asyncio.wait(
                    [task_client, task_server],
                    return_when=asyncio.FIRST_COMPLETED,
                )

                # Cleanup other tasks
                for task in pending:
                    task.cancel()

                #
                # --- PATCH 3: Graceful close without server crash ---
                #
                try:
                    await ws_server.close()
                except Exception:
                    pass

                try:
                    await ws_client.close()
                except Exception:
                    pass

                return ws_client

        except Exception:
            # Extra failsafe
            await ws_client.close(code=1011, message=b"Unhandled WebSocket proxy error")
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
