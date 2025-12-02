# HA Intercom

An intercom and announcement system for use with Home Assistant.

![Inercom Features](assets/all-features.png)

## Features

- Low latency audio intercom for supported media_player types
- Announcements via TTS to supported media_player types (ie: Alexa)

## Notes

This is a work in progress. I'm porting this over from a standalone container solution to a Home Assistant Integration. As a result, there are several environment variables used for the Docker container that are likely unnecessary and can be inferred from context. While I'm sorting that, use as documented.

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
    name: Audio Intercom
    ttsPrefix: "Incoming Notification:"
    hideStatus: false
    hideTranscription: false
    target:
        - entity_id: media_player.esp32_media_player
          type: audio

- type: custom:ha-intercom-card
    name: TTS Intercom
    target:
        - entity_id: media_player.esp32_media_player2
          type: tts
          voice: my-piper-voice-medium

- type: custom:ha-intercom-card
    name: Alexa Intercom
    target:
        - entity_id: media_player.my_alexa
          type: alexa

- type: custom:ha-intercom-card
    name: Fire TV Intercom
    target:
        - entity_id: media_player.fire_tv
          type: alexa
            data:
                type: announce

- type: custom:ha-intercom-card
    name: Everywhere Intercom
    target:
        - entity_id: media_player.esp32_media_player
          type: audio
        - entity_id: media_player.esp32_media_player2
          type: tts
          voice: my-piper-voice-medium
        - entity_id: media_player.my_alexa
          type: alexa
        - entity_id: media_player.fire_tv
          type: alexa
            data:
                type: announce
```

## Requirements

- Docker
- HTTPS connection to Home Assistant (for micorphone use)
- Faster-Whisper for STT

## Installation

- Clone repo
- Add .env file to root
- run `docker compose build`
- run `docker compose up`

# Environment Settings (.env file)

- HOST=192.168.1.X (optional)
- PORT=3001 (optional)
- AUDIO_HOST=http://192.168.1.X:3001 (optional. Derived from the Home Assistant HA-Intercom config. Set this to override)
- WHISPER_HOST=192.168.1.X:10300 (required. the IP Address and PORT of your Whisper instance)
- HOME_ASSISTANT_URL=https://my-ha-instance-url:8123 (optional. Will use your Home Assistant External URL, Internal URL, or request origination url, in that order. Set this to override.)
- HOME_ASSISTANT_ACCESS_TOKEN= ... (optional. Will use a token passed via the integration. Set this to override.)
- TTS_PREFIX=Incoming Notification: (optional)
