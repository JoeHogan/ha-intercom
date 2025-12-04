import asyncio
import urllib.parse
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from aiohttp import web, WSMsgType
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from .const import DOMAIN, CONF_SERVICE_URL


async def async_register_proxy(hass: HomeAssistant, entry: ConfigEntry):
    """Register a proxy route that forwards all HTTP methods to the configured HA Intercom service."""

    # Updated to return (user, refresh_token) tuple
    async def authenticate(request: web.Request):
        """Authenticates the request and returns the User object and the RefreshToken object (if available)."""
        # Already authenticated by HA middleware
        hass_user = request.get("hass_user")
        if hass_user:
            # If authenticated via middleware/session, we only get the User object.
            # No RefreshToken is available, so return None for the token object.
            return hass_user, None

        # Fallback: token in query param
        token = request.query.get("token")
        if not token:
            return None, None

        # Validate using HA token validation (sync in your version)
        refresh_token = hass.auth.async_validate_access_token(token)
        if refresh_token is None:
            return None, None

        # Return user and the refresh token object (token was provided)
        return refresh_token.user, refresh_token

    # ----------------------------
    # WEBSOCKET PROXY
    # ----------------------------
    async def websocket_proxy(request: web.Request):
        """Proxy WebSocket connections to the backend MediaMTX service."""

        # --- 1. Validate auth ---
        # Unpack the returned tuple (user, refresh_token_obj)
        user, refresh_token_obj = await authenticate(request)

        # If no user was found, deny access
        if user is None:
            return web.Response(status=401, text="Unauthorized")

        # --- 2. Build backend WebSocket URL with custom query parameters ---

        clientId = request.query.get("id")

        # 2.1 Determine the HA URL to send to the backend, prioritizing configured URLs
        ha_url = None
        # Priority 1: External URL
        if hass.config.external_url:
            ha_url = hass.config.external_url.rstrip("/")
        # Priority 2: Internal URL
        elif hass.config.internal_url:
            ha_url = hass.config.internal_url.rstrip("/")
        # Priority 3: Fallback to the URL used for the current request
        else:
            ha_url = f"{request.url.scheme}://{request.host}"

        # Initialize parameters with the mandatory haUrl
        new_params = {
            "id": clientId,
            "haUrl": ha_url,
        }

        # 2.2 Generate a new short-lived access token ONLY if a RefreshToken was provided
        if refresh_token_obj:
            # FIX: Removed 'await' since Pylance indicates the function returns 'str' (a synchronous result)
            ha_token = hass.auth.async_create_access_token(
                refresh_token_obj, request.remote
            )
            # Conditionally add the haToken parameter
            new_params["haToken"] = ha_token

        # 2.3 Determine the backend's base URL
        entry_data = hass.data[DOMAIN].get(entry.entry_id)

        # --- Guard against missing entry_data ---
        if not entry_data:
            return web.Response(
                status=500,
                text="Internal Server Error: Integration configuration data is missing.",
            )
        # ------------------------------------------

        base_url_config = entry_data[CONF_SERVICE_URL].rstrip("/")

        # Convert http(s) to ws(s)
        if base_url_config.startswith("https://"):
            ws_base_url = base_url_config.replace("https://", "wss://", 1)
        elif base_url_config.startswith("http://"):
            ws_base_url = base_url_config.replace("http://", "ws://", 1)
        else:
            ws_base_url = base_url_config  # assume user entered ws:// or wss://

        # Add the audioHost parameter conversion
        if base_url_config.startswith("wss://"):
            audio_host = base_url_config.replace("wss://", "https://", 1)
        elif base_url_config.startswith("ws://"):
            audio_host = base_url_config.replace("ws://", "http://", 1)
        else:
            audio_host = base_url_config  # assume user entered http:// or https://

        new_params["audioHost"] = audio_host

        target_path = "/api/ha_intercom/ws"

        # Safely encode the parameters (which may or may not include haToken)
        query_string = urllib.parse.urlencode(new_params)
        target_url = f"{ws_base_url}{target_path}?{query_string}"

        # --- 3. Prepare outgoing WebSocket to client ---
        ws_client = web.WebSocketResponse()
        await ws_client.prepare(request)

        # Use HA-managed ClientSession
        session = async_get_clientsession(hass)
        ws_server = None

        # --- 4. Connect to backend WebSocket ---
        try:
            try:
                # Use the target_url including the query parameters
                ws_server = await session.ws_connect(target_url)
            except Exception:
                await ws_client.close(
                    code=1011,
                    message=b"Backend WebSocket connection failed",
                )
                return ws_client

            # --- 5. Proxy in both directions using explicit task management ---

            async def client_to_server():
                async for msg in ws_client:
                    if msg.type == web.WSMsgType.TEXT:
                        await ws_server.send_str(msg.data)
                    elif msg.type == web.WSMsgType.BINARY:
                        await ws_server.send_bytes(msg.data)
                    elif msg.type in (web.WSMsgType.CLOSE, web.WSMsgType.ERROR):
                        # Signal closure to server
                        await ws_server.close()
                        break
                # Ensure the function returns clean
                return "client_closed"

            async def server_to_client():
                async for msg in ws_server:
                    if msg.type == web.WSMsgType.TEXT:
                        await ws_client.send_str(msg.data)
                    elif msg.type == web.WSMsgType.BINARY:
                        await ws_client.send_bytes(msg.data)
                    elif msg.type in (web.WSMsgType.CLOSE, web.WSMsgType.ERROR):
                        # Signal closure to client
                        await ws_client.close()
                        break
                # Ensure the function returns clean
                return "server_closed"

            # Create tasks
            client_task = asyncio.create_task(client_to_server())
            server_task = asyncio.create_task(server_to_client())

            # Wait for either task to complete
            done, pending = await asyncio.wait(
                [client_task, server_task],
                return_when=asyncio.FIRST_COMPLETED,
            )

            # --- 6. Explicitly cancel and clean up the remaining task ---
            for task in pending:
                task.cancel()

            # Re-raise exceptions from the completed tasks to surface errors if necessary
            for task in done:
                task.result()

        except asyncio.CancelledError:
            # This is expected if the HA side cancels the coroutine
            pass
        except Exception:
            # Handle other unexpected proxy errors
            if not ws_client.closed:
                await ws_client.close(
                    code=1011, message=b"Unhandled WebSocket proxy error"
                )

        finally:
            # Ensure both WebSockets are closed regardless of task state
            if not ws_client.closed:
                await ws_client.close()
            if ws_server and not ws_server.closed:
                await ws_server.close()

            return ws_client

    # ----------------------------
    # MAIN PROXY HANDLER
    # ----------------------------

    async def handle_proxy(request: web.Request):
        """Forward any request (including OPTIONS) to the configured service URL."""

        # Authenticate user. We only need the user object here, not the refresh token.
        hass_user, _ = await authenticate(request)
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

        # Use HA-managed ClientSession
        session = async_get_clientsession(hass)

        # Proxy the request to the backend service
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
