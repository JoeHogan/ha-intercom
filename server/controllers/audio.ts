import { createFfmpegInstance, createSttFfmpegInstance, ffmpegQueue, outputType, sttFfmpegQueue } from "./ffmpeg.ts";
import { postAudio, postAlexaTTS, postTTS } from "./ha.ts";
import type { RoomState } from "../models/interfaces.ts";
import { postSTT } from "./stt.ts";

const getEntitiesByType = (entities, type) => {
    type = (type || '').toLowerCase();
    return entities.filter(item => item.type.toLowerCase().trim() === type);
};

export const setPlayers = (room: RoomState) => {
    room.targets
    .filter(item => !!item?.entity_id)
    .map(item => {
        let entity_id = item.entity_id.trim();
        let type = entity_id.startsWith('ha_client') ? 'audio' : item.type ? item.type.trim().toLowerCase() : 'tts';
        return {
            type,
            entity_id
        };
    })
    .filter((item, i, arr) => arr.findIndex(ai => ai.entity_id === item.entity_id) === i);
    room.entities.video = getEntitiesByType(room.targets, 'video');
    room.entities.audio = getEntitiesByType(room.targets, 'audio');
    room.entities.stt = getEntitiesByType(room.targets, 'tts');
    room.entities.alexa = getEntitiesByType(room.targets, 'alexa');
};

export const startAudio = (room: RoomState, sdpString: string) => { 

    const audioClients = room.entities.audio.filter(item => !item.entity_id.startsWith('ha_client'));

    if(!audioClients.length) {
        return null;
    }

    let currentInstance = ffmpegQueue.pop(); 

    if (!currentInstance) {
        console.warn("Audio Pool empty. Synchronously creating a temporary instance.");
        currentInstance = createFfmpegInstance(); 
    }

    currentInstance.child.stdin.write(sdpString);
    currentInstance.child.stdin.end();

    room.ffmpeg.audio = currentInstance;
    
    currentInstance.active = true;

    console.log(`Room ${room.id} started AUDIO session with FFMPEG [PID ${currentInstance.pid}].`);

    console.log(`${room.id}: .${outputType} to ${room.entities.audio.map(({entity_id}) => entity_id).join(', ')}`);

    postAudio(room, audioClients); 

};

export const startSTT = (room: RoomState, sdpString: string) => { 

    if((room.entities.stt.length + room.entities.alexa.length) === 0) {
        return null;
    }

    let currentInstance = sttFfmpegQueue.pop(); // Get from dedicated STT pool

    if (!currentInstance) {
        console.warn("STT Pool empty. Synchronously creating a temporary instance.");
        currentInstance = createSttFfmpegInstance();
    }

    currentInstance.child.stdin.write(sdpString);
    currentInstance.child.stdin.end();

    room.ffmpeg.stt = currentInstance;
    
    console.log(`Room ${room.id} started STT session with FFMPEG [PID ${currentInstance.pid}].`);

    currentInstance.child.stdout.removeAllListeners('end'); 

    currentInstance.child.stdout.on('end', async () => {
        const wavBuffer = Buffer.concat(currentInstance.wavChunks);
    
        currentInstance.wavChunks.length = 0; 
    
        postSTT(wavBuffer)
            .then((res: any) => {
            let message = res?.text?.trim();
            room.clients.get(room.hostProducerId)?.ws.send(JSON.stringify({type: 'transcription', text: (message || '[no text]')}));
            if (message) {
                if(room.entities.stt.length) {
                    console.log(`${room.id}: Sending STT to ${room.entities.stt.map(({entity_id}) => entity_id).join(', ')}`);
                    postTTS(room, message, room.entities.stt);
                }
                if(room.entities.alexa.length) {
                    console.log(`${room.id}: Sending ALEXA TTS to ${room.entities.alexa.map(({entity_id}) => entity_id).join(', ')}`);
                    postAlexaTTS(room, message, room.entities.alexa);
                }
            }
            })
            .catch(() => room.clients.get(room.hostProducerId)?.ws.send(JSON.stringify({type: 'transcription', text: '[error transcribing audio]'})));
    });

    return currentInstance;
};