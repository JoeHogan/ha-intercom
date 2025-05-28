# HA Intercom

An intercom and announcement system for use with Home Assistant.

## Features

- Low latency audio intercom for supported media_player types
- Announcements via TTS to supported media_player types (ie: Alexa)

## Home Assistant YAML config example

```yaml
- type: custom:intercom-widget
    name: Audio Intercom
    target:
        - entity_id: media_player.esp32_media_player
          type: audio

- type: custom:intercom-widget
    name: TTS Intercom
    target:
        - entity_id: media_player.esp32_media_player2
          type: tts
          voice: my-piper-voice-medium

- type: custom:intercom-widget
    name: Alexa Intercom
    target:
        - entity_id: media_player.my_alexa
          type: alexa

- type: custom:intercom-widget
    name: Fire TV Intercom
    target:
        - entity_id: media_player.fire_tv
          type: alexa
            data:
                type: announce

- type: custom:intercom-widget
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

- HOST=192.168.1.X
- PORT=3001
- AUDIO_HOST=http://192.168.1.X:3001
- WHISPER_HOST=192.168.1.X
- WHISPER_PORT=10300
- HOME_ASSISTANT_URL=https://my-ha-instance-url:8123
- HOME_ASSISTANT_ACCESS_TOKEN= ...