
import axios from 'axios';

const haUrl = process.env.HOME_ASSISTANT_URL;
const token = process.env.HOME_ASSISTANT_ACCESS_TOKEN;
const ttsPrefix = process.env.TTS_PREFIX || null;
const audioHost = process.env.AUDIO_HOST || `http://${(process.env.HOST || 'localhost')}:${(process.env.PORT || 3001)}`;

export const postAudio = (wssId, entities) => {
    return Promise.all(entities.map((entity) => {
        return axios.post(
            `${haUrl}/api/services/media_player/play_media`,
            {
                entity_id: entity.entity_id,
                media_content_id: `${audioHost}/listen/${wssId}`,
                media_content_type: "music" // best choice for mp3
            },
            {
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            }
        )
        .then(() => {
            console.log(`streming to media player ${entity.entity_id}`);
        }).catch((err) => {
            console.error(`error streaming to media player ${entity.entity_id}: ${err}`);
            return null;
        });
    }));
};

export const postAlexaTTS = (message, entities) => {
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
            `${haUrl}/api/services/notify/alexa_media`, payload, {
                headers: {
                    Authorization: `Bearer ${token}`,
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

export const postTTS = (message, entities) => {
    return Promise.all(entities.map((entity) => {

        let payload = {
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
            `${haUrl}/api/services/tts/speak`, payload,
             {
                headers: {
                    Authorization: `Bearer ${token}`,
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