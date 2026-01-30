# HA Intercom

An intercom and announcement system for use with Home Assistant.

![Collapsable configuration](assets/collapse.png)
- One intercom configuration for multiple targets and clients

![Client Configuration Form](assets/incoming.png)
- Incoming audio/video calls now displayed by recieving clients (if capable)

![Inercom Features](assets/all-features.png)
- The original mode is still supported

## Features

- WebRTC based client-to-client Audio/Video calling (clients include other devices using a dashboard with HA-Intercom on them, like Wallpanels)
- WebRTC based, low latency, one-way audio intercom/announcements for supported media_player types
- Announcements via TTS media_player types that do not support local audio (ie: Alexa Media Player)

## Notes

Release 3.0 moved to a WebRTC model for lower latency and better client-to-client support.
Due to browser security, user's must interact with the webpage to recieve incoming audio/video. HA-Intercom clients will, by default, display an button in the bottom right corner to remind you to interact with the page. This can be disabled in the config. This is not a limitation on sending audio/tts to other devices, just other clients.

## Container Installation

### Docker Images
https://hub.docker.com/repository/docker/josephhogan/ha-intercom/general

```
image: josephhogan/ha-intercom:latest
```

Please see below for required environment variables for the Docker container.

## Home Assistant Installation (via HACS)

1. Go to HACS → Integrations → ⋮ → Custom repositories.
2. Add:

https://github.com/JoeHogan/ha-intercom

with category **Integration**.
3. Install **HA Intercom**.
4. Restart Home Assistant.
5. Add the integration via *Settings → Devices & Services → Add Integration → HA Intercom*.
6. Input the URL and port of your HA Intercom docker instance

## Home Assistant YAML config example

```yaml
  - type: custom:ha-intercom-card
    clientId: client_1
    video: true
    display: collapse
    position: inline
    autoFullscreen: true
    targets:
      - name: Main Floor TV
        entities:
          - entity_id: media_player.my_fire_tv
            type: alexa
            data:
              type: announce
      - name: Kitchen
        entities:
          - entity_id: >-
              media_player.esphome_voice_satellite
            type: audio
      - name: Kitchen and TV
        entities:
          - entity_id: >-
              media_player.esphome_voice_satellite
            type: audio
          - entity_id: media_player.my_fire_tv
            type: alexa
            data:
              type: announce
```

### Config options

- clientId
    - string
    - create a unique ID for your intecom; this is used to identify the client instance on the backend
- video
    - boolean
    - default: false
    - whether your client supports video (assumes you have a camera)
- display
    - default, collapse, single
    - default: default
    - how you want the card to behave when showing clients; using the 'single' option reverts to using the version 1.x mode of a single intercom that you hold to speak
- position
    - inline, fixed
    - default: fixed
    - determines where on the screen you want outgoing/incoming messages to be displayed. Fixed positions the container on the bottom right of your screen when a message is being sent/recieved
- autoFullscreen
    - boolean
    - default: false
    - when recieving an incoming message, go to full-screen automatically.
- hideInteractButton
    - boolean
    - default: false
    - hide the 'interact' button on the bottom right that ensures user has interacted with the screen in order to recieve incoming calls

### Client Configuration

- After configuring your YAML, you will be presented with the client configuration to give your ha-intercom client instance a name and entity_id. The purpose of this is to identify different clients using the same configuration on the same dashboard. For example, you may share one dashboard for all of your wallpanels; in order to call wallpanel one from wallpanel two, they need unique ids which cannot be done in the yaml config (since it is the same dashboard). This configuration provides you that ability.

![Client Configuration Form](assets/create_config.png)

![Client Configuration Information](assets/display_config.png)


## Requirements

- Docker
- HTTPS connection to Home Assistant (for micorphone use)
- Faster-Whisper for STT

## Installation

- Clone repo
- Add .env file to root
- run `docker compose build`
- run `docker compose up`

# Docker Compose Example

## Due to the use of WebRTC, you MUST use network_mode: "host"
### You can directly pass your IP address and preferred port, if necessary, as environment variables
## For your config to be saved, please map the volume as shown below

```yaml
services:
  ha_intercom:
    image: josephhogan/ha-intercom:latest
    container_name: ha-intercom
    environment:
      WEBRTC_HOST_IP: 192.168.1.X # optional, if it cannot be inferred correctly within container
      PORT: 3001 # optional, but useful since network_mode: "host" is required and port defaults to 3001
      AUDIO_HOST: "http://192.168.X.X:3001" # optional
      HOME_ASSISTANT_URL: "http://192.168.X.X:8123" #optional
      WHISPER_HOST: "192.168.X.X:10300" # required for TTS
      TTS_PREFIX: "Incoming Notification:" # optional
      HOME_ASSISTANT_ACCESS_TOKEN: "[your long-lived access token]" # optional
    restart: always
    network_mode: "host"
```

# Environment Variables

- WEBRTC_HOST_IP=192.168.1.X
  - Optional
  - Derived from environment
  - Set this to override the address the WebRTC server uses to advertise
- PORT=3001
  - Optional
  - Defalts to 3001
  - Set this to override the default port, which is more useful now that network_mode: "host" is required
- AUDIO_HOST=http://192.168.1.X:3001
    - Optional
    - Derived from the Home Assistant HA-Intercom config.
    - Set this to override the Integration default.
- WHISPER_HOST=192.168.1.X:10300
    - Required for STT
    - The IP Address and PORT of your Whisper instance.
- HOME_ASSISTANT_URL=https://my-ha-instance-url:8123
    - Optional
    - Will use your configured Home Assistant External URL, Internal URL, or the derived request origination url, in that order by default.
    - Set this to override the Integration default.
- HOME_ASSISTANT_ACCESS_TOKEN= ... 
    - Optional
    - Will use a token passed via the integration by default.
    - Set this to override the Integration default.
- TTS_PREFIX=Incoming Notification:
    - Optional
    - Used to prefix TTS notifications.
    - Can also be set in the HA-Intercom YAML config per device. Doing so will override this global value.
- AUDIO_POOL_SIZE=2
    - Optional pool size for warm FFMPEG audio instances
    - Default: 2
- STT_POOL_SIZE=2
    - Optional pool size for warm FFMPEG stt instances
    - Default: 1
- OUTPUT_TYPE=mp3
    - Optional
    - Options: mp3, wav
    - Default: mp3
