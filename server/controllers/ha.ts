
import axios from 'axios';
import https from 'https';
import { AUDIO_CONFIG, outputType } from './ffmpeg.ts';
import type { RoomState } from '../models/interfaces.ts';

const httpsAgent = new https.Agent({
  rejectUnauthorized: false, // disables SSL cert verification
});

const ttsPrefix = process.env.TTS_PREFIX || null;

export const postAudio = (room: RoomState, entities) => {
    return Promise.all(entities.map((entity) => {
        return axios.post(
            `${room.environment.haUrl}/api/services/media_player/play_media`,
            {
                entity_id: entity.entity_id,
                media_content_id: `${room.environment.audioHost}/listen/${room.id}/audio.${outputType}`,
                media_content_type: `${AUDIO_CONFIG[outputType]?.audioType || 'music'}`,
                announce: true,
            },
            {
                httpsAgent,
                headers: {
                    Authorization: `Bearer ${room.environment.haToken}`,
                    'Content-Type': 'application/json'
                }
            }
        )
        .then(() => { // if POST is successful but endpoint is never called, make sure media player entity is online
            console.log(`streming to media player ${entity.entity_id}`);
        }).catch((err) => {
            console.error(`error streaming to media player ${entity.entity_id}: ${err}`);
            return null;
        });
    }));
};

export const postAlexaTTS = (room: RoomState, message, entities) => {
    return Promise.all(entities.map((entity) => {
        const payload = {
            message: [(entity.tts_prefix || ttsPrefix || ''), message].join(' ').trim(),
            data: {
                type: entity.data?.type ?? 'tts', // or 'announce' (announce makes it chime and say it)
                method: entity.data?.method ?? 'all' // optional: 'all' or 'speak' depending on behavior
            },
            target: [entity.entity_id]
        };
        return axios.post(
            `${room.environment.haUrl}/api/services/notify/alexa_media`, payload, {
                httpsAgent,
                headers: {
                    Authorization: `Bearer ${room.environment.haToken}`,
                    'Content-Type': 'application/json'
                }
            }
        ).then(() => {
            console.log(`TTS sent to alexa media player ${entity.entity_id}`);
        }).catch((err) => {
            console.error(`error sending TTS to alexa media players ${entity.entity_id}: ${err}`);
            return null;
        });
    }));
};

export const postTTS = (room: RoomState, message, entities) => {
    return Promise.all(entities.map((entity) => {

        let payload: any = {
            entity_id: 'tts.piper',
            media_player_entity_id: entity.entity_id,
            message: [(entity.tts_prefix ?? ttsPrefix ?? ''), message].join(' ').trim(),
            cache: false
        };

        if(entity.voice) {
            payload.options = {
                voice: entity.voice
            };
        }
        
        return axios.post(
            `${room.environment.haUrl}/api/services/tts/speak`, payload,
             {
                headers: {
                    Authorization: `Bearer ${room.environment.haToken}`,
                    'Content-Type': 'application/json'
                }
            }
        )
        .then(() => {
            console.log(`TTS sent to media player ${entity.entity_id}`);
        }).catch((err) => {
            console.error(`error sending TTS to media player ${entity.entity_id}: ${err}`);
            return null;
        })
    }));
};