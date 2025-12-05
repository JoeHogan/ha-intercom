import 'dotenv/config';
import http from 'http';
import path from'path';
import { WebSocketServer } from 'ws';
import express from'express';
import { v4 as uuidv4 } from 'uuid';
import { PassThrough } from 'stream';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';
import { postSTT } from './server/stt.mjs';
import { postAudio, postAlexaTTS, postTTS } from './server/ha.mjs';
import { getMessage, encodeMessage } from './server/ws.mjs';

const haUrl = process.env.HOME_ASSISTANT_URL;
const token = process.env.HOME_ASSISTANT_ACCESS_TOKEN;
const audioHost = process.env.AUDIO_HOST;
const audioPoolSize = process.env.AUDIO_POOL_SIZE ? parseInt(process.env.AUDIO_POOL_SIZE) : 2; // For audio streaming
const sttPoolSize = process.env.STT_POOL_SIZE ? parseInt(process.env.STT_POOL_SIZE) : 1; // For STT transcription

const app = express();
const server = http.createServer(app);
const port = 3001;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Global Pools
const ffmpegQueue = []; // Audio Streaming (MP3) Pool
const sttFfmpegQueue = []; // STT Processing (WAV) Pool

// Active Session Maps
const activeFfmpegSessions = new Map(); // Maps wssId -> Audio Instance
const activeSttSessions = new Map();    // Maps wssId -> STT Instance

class ClientSession {
    constructor(config = {}) {
        this.wssId = uuidv4();
        this.id = config.id;
        this.haUrl = haUrl || config.haUrl;
        this.haToken = token || config.haToken;
        this.audioHost = audioHost || config.audioHost || `http://localhost:3001`;
    }
}

const audioStreams = {};

// --- GLOBAL FACTORY AND HELPER FUNCTIONS (DEFINED ONCE) ---

const createFfmpegInstance = () => {
    const child = spawn('ffmpeg', [
        '-probesize', '32',
        '-analyzeduration', '0',
        '-f', 'webm',
        '-i', 'pipe:0', 
        '-f', 'mp3',
        '-acodec', 'libmp3lame',
        '-ar', '44100',
        '-compression_level', '0', 
        '-flush_packets', '1', 
        '-'
    ]);
    const inputPassThrough = new PassThrough();
    inputPassThrough.pipe(child.stdin);

    child.stderr.on('data', data => {
        console.error(`FFMPEG [PID ${child.pid}] (Audio) stderr:`, data.toString());
    });
    child.on('error', (err) => {
        console.error(`FFMPEG [PID ${child.pid}] (Audio) process error:`, err);
    });

    return { child, input: inputPassThrough, pid: child.pid, active: false };
};

const createSttFfmpegInstance = () => {
    const child = spawn('ffmpeg', [
        '-f', 'webm', 
        '-i', 'pipe:0', 
        '-ac', '1', 
        '-ar', '16000', 
        '-f', 'wav', 
        'pipe:1' 
    ]);
    const inputPassThrough = new PassThrough();
    inputPassThrough.pipe(child.stdin);

    child.stderr.on('data', data => {
        console.error(`FFMPEG [PID ${child.pid}] (STT) stderr:`, data.toString());
    });
    child.on('error', (err) => {
        console.error(`FFMPEG [PID ${child.pid}] (STT) process error:`, err);
    });
    
    const wavChunks = [];
    child.stdout.on('data', chunk => {
        wavChunks.push(chunk);
    });

    return { child, input: inputPassThrough, pid: child.pid, active: false, wavChunks };
};

const killInstance = (ffmpeg) => {
    if (ffmpeg?.child) {
        ffmpeg.input.end();
        ffmpeg.child.stdin.end();
        ffmpeg.child.kill('SIGKILL');
        console.log(`FFMPEG [PID ${ffmpeg.pid}] forcefully terminated.`);
    }
};

const refillFFmpegPool = () => {
    while (ffmpegQueue.length < audioPoolSize) {
        console.log("Audio Pool refill initiated...");
        const instance = createFfmpegInstance(); 
        ffmpegQueue.push(instance);
        console.log(`Refilled Audio Pool with [PID ${instance.pid}]. Current size: ${ffmpegQueue.length}`);
    }
};

const refillSttPool = () => {
    while (sttFfmpegQueue.length < sttPoolSize) {
        console.log("STT Pool refill initiated...");
        const instance = createSttFfmpegInstance(); 
        sttFfmpegQueue.push(instance);
        console.log(`Refilled STT Pool with [PID ${instance.pid}]. Current size: ${sttFfmpegQueue.length}`);
    }
};

const initializeFFmpegPools = () => {
    refillFFmpegPool();
    refillSttPool();
};

const getEntitesByType = (targets, type) => {
    type = (type || '').toLowerCase();
    return targets.filter(item => item.type.toLowerCase().trim() === type);
};

// --- CONNECTION HANDLER FUNCTION ---
const handleConnection = (ws, request) => {
    console.log('WebSocket client connected');

    let audioEntities;
    let ttsEntities;
    let alexaEntities;
    
    const url = new URL(request.url, `http://localhost:${port}`);
    const id = url.searchParams.get('id');
    const haUrl = url.searchParams.get('haUrl');
    const haToken = url.searchParams.get('haToken');
    const audioHost = url.searchParams.get('audioHost');
    ws.clientId = id;

    const clientSession = new ClientSession({id, haUrl, haToken, audioHost});

    const setPlayers = (header) => {
        let targets = (header.target || [])
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
        audioEntities = getEntitesByType(targets, 'audio');
        ttsEntities = getEntitesByType(targets, 'tts');
        alexaEntities = getEntitesByType(targets, 'alexa');
    };

    // --- Core Logic Functions (defined within handler to access client-specific state) ---

    const startAudio = (client) => {

        if(!audioEntities.length) {
            return null;
        }

        let currentInstance = ffmpegQueue.pop(); 

        if (!currentInstance) {
            console.warn("Audio Pool empty. Synchronously creating a temporary instance.");
            currentInstance = createFfmpegInstance(); 
        }

        activeFfmpegSessions.set(client.wssId, currentInstance);
        currentInstance.active = true;
        
        console.log(`WS ${client.id} started AUDIO session with FFMPEG [PID ${currentInstance.pid}]`);
        
        process.nextTick(refillFFmpegPool);
        console.log(`Scheduled Audio pool refill.`);
        
        const audioStream = new PassThrough();
        audioStreams[client.wssId] = audioStream;

        console.log(`${client.wssId}: Sending AUDIO (MP3) to ${audioEntities.map(({entity_id}) => entity_id).join(', ')}`);

        let haClients = audioEntities.filter(item => item.entity_id.startsWith('ha_client'));
        let audioClients = audioEntities.filter(item => !item.entity_id.startsWith('ha_client'));
        postAudio(client, audioClients);
        
        currentInstance.child.stdout.removeAllListeners('data'); 

        currentInstance.child.stdout.on('data', chunk => {
            let buffer = Buffer.from(chunk);
            if (audioStream.writable) {
                 audioStream.write(buffer);
            }

            if(haClients.length) {
                let haClientIds = haClients.filter(item => !!item.entity_id).map(item => item.entity_id.split('.')[item.entity_id.split('.').length -1]);
                wss.clients
                    .forEach((item) => {
                        if(item.clientId && haClientIds.indexOf(item.clientId) > -1) {
                            item.send(encodeMessage({type: 'audio', from: client.id}, buffer).toJSON());
                        }
                    });
            }
        });
        
        // --- CRITICAL FIX: Signal PassThrough end when FFMPEG output is complete ---
        currentInstance.child.stdout.removeAllListeners('end');
        currentInstance.child.stdout.on('end', () => {
            if (audioStream.writable) {
                 console.log(`FFMPEG [PID ${currentInstance.pid}] stdout closed. Ending PassThrough stream.`);
                audioStream.end();
            }
        });
        // --------------------------------------------------------------------------

        const onStreamClose = () => {
            console.log(`PassThrough stream for ${client.wssId} closed.`);
            delete audioStreams[client.wssId];
            currentInstance.child.stdout.removeAllListeners('data'); 
            currentInstance.child.stdout.removeAllListeners('end'); // Clean up end listener too
        };

        audioStream.on('close', onStreamClose);
        // We only listen to 'close' now, 'end' will be triggered by audioStream.end()
    };

    const startSTT = (client) => {

        if((ttsEntities.length + alexaEntities.length) === 0) {
            return null;
        }

        let currentInstance = sttFfmpegQueue.pop();

        if (!currentInstance) {
            console.warn("STT Pool empty. Synchronously creating a temporary instance.");
            currentInstance = createSttFfmpegInstance();
        }

        activeSttSessions.set(client.wssId, currentInstance);
        currentInstance.active = true;
        
        console.log(`WS ${client.id} started STT session with FFMPEG [PID ${currentInstance.pid}]`);

        process.nextTick(refillSttPool);
        console.log(`Scheduled STT pool refill.`);

        currentInstance.child.stdout.removeAllListeners('end'); 

        currentInstance.child.stdout.on('end', async () => {
            const wavBuffer = Buffer.concat(currentInstance.wavChunks);
            
            currentInstance.wavChunks.length = 0; 
            
            postSTT(wavBuffer)
                .then((res) => {
                    let message = res?.text?.trim();
                    ws.send(encodeMessage({type: 'transcription', text: (message || '[no text]')}).toJSON());
                    if (message) {
                        if(ttsEntities.length) {
                            console.log(`${client.wssId}: Sending TTS to ${ttsEntities.map(({entity_id}) => entity_id).join(', ')}`);
                            postTTS(client, message, ttsEntities);
                        }
                        if(alexaEntities.length) {
                            console.log(`${client.wssId}: Sending ALEXA TTS to ${alexaEntities.map(({entity_id}) => entity_id).join(', ')}`);
                            postAlexaTTS(client, message, alexaEntities);
                        }
                    }
                })
                .catch(() => ws.send(encodeMessage({type: 'transcription', text: '[error transcribing audio]'}).toJSON()));
        });
        
        return currentInstance;
    };


    const stop = () => {
        // --- STT Cleanup ---
        const sttInstanceToKill = activeSttSessions.get(clientSession.wssId);
        
        if (sttInstanceToKill) {
            // 1. Signal EOF to FFMPEG STT instance input immediately
            if (sttInstanceToKill.input.writable) {
                console.log(`FFMPEG [PID ${sttInstanceToKill.pid}] STT input closed (EOF signal).`);
                sttInstanceToKill.input.end();
            }

            sttInstanceToKill.active = false;
            activeSttSessions.delete(clientSession.wssId);

            // 2. Kill the instance after a short delay to ensure transcription output is complete
            setTimeout(() => {
                killInstance(sttInstanceToKill);
            }, 500); 
        }

        // --- Audio Cleanup ---
        const audioInstanceToKill = activeFfmpegSessions.get(clientSession.wssId);
        
        if (audioInstanceToKill) {
            // 1. Signal EOF to FFMPEG Audio instance input immediately
            if (audioInstanceToKill.input.writable) {
                console.log(`FFMPEG [PID ${audioInstanceToKill.pid}] Audio input closed (EOF signal).`);
                audioInstanceToKill.input.end();
            }

            audioInstanceToKill.active = false;
            activeFfmpegSessions.delete(clientSession.wssId);

            console.log(`FFMPEG [PID ${audioInstanceToKill.pid}] released. Scheduling Audio cleanup in 5s...`);
            
            // 2. Schedule delayed cleanup: ONLY KILL THE PROCESS
            // The audioStream.end() handled by FFMPEG's stdout 'end' event.
            setTimeout(() => {
                // IMPORTANT: We only kill the process here. The stream should be closed by FFMPEG itself.
                const audioStream = audioStreams[clientSession.wssId];
                if(audioStream && audioStream.writable) {
                    // Forcefully terminate if FFMPEG failed to close its stdout for some reason
                    // and the stream is still writable after 5s.
                    console.warn(`[PID ${audioInstanceToKill.pid}] Forced audio stream closure before killing.`);
                    audioStream.end(); 
                }
                killInstance(audioInstanceToKill);
            }, 5000); 
        }
    };

    // --- WebSocket Event Handlers ---
    ws.on('message', data => {

        const {header, payload} = getMessage(data);
        const currentActiveAudioInstance = activeFfmpegSessions.get(clientSession.wssId);
        const currentActiveSttInstance = activeSttSessions.get(clientSession.wssId);
      
        if(header.type === 'ping') {
            ws.send(encodeMessage({type: 'pong'}));
        }
        if(header.type === 'start') {
            setPlayers(header);
            console.log([`Client ID: ${clientSession.id || 'Not Set'}`, `HA Url: ${clientSession.haUrl}`, `Audio Host Url: ${clientSession.audioHost}`, `HA Token present: ${clientSession.haToken ? 'TRUE' : 'FALSE'}`].join(' | '));
            startAudio(clientSession);
            startSTT(clientSession);
        }
        if(header.type === 'stop') {
            stop(); 
        }
        if(header.type === 'data') {
            if (currentActiveAudioInstance?.active && currentActiveAudioInstance.input.writable) {
                currentActiveAudioInstance.input.write(payload);
            }
            if (currentActiveSttInstance?.active && currentActiveSttInstance.input.writable) {
                currentActiveSttInstance.input.write(payload);
            }
        }
    });

    ws.on('close', (code, reason) => {
        console.log(`Client disconnected: ${code}, ${reason}`);
        
        const activeAudioInstance = activeFfmpegSessions.get(clientSession.wssId);
        if (activeAudioInstance) {
            killInstance(activeAudioInstance);
            activeFfmpegSessions.delete(clientSession.wssId);
        }
        
        const activeSttInstance = activeSttSessions.get(clientSession.wssId);
        if (activeSttInstance) {
            killInstance(activeSttInstance);
            activeSttSessions.delete(clientSession.wssId);
        }
        
        if (audioStreams[clientSession.wssId]) {
             audioStreams[clientSession.wssId].end();
        }
    });

};
// --- END OF CONNECTION HANDLER FUNCTION ---

app.use(express.static('custom_components/ha_intercom/www'));

const wss = new WebSocketServer({ noServer: true });

wss.on('connection', handleConnection); 

// --- EXECUTE POOL INITIALIZATION ---
initializeFFmpegPools();
// -----------------------------------

server.on('upgrade', (request, socket, head) => {
  if (request.url.startsWith('/api/ha_intercom/ws')) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

app.get('/listen/:wssId/audio.mp3', (req, res) => {
    const wssId = req.params.wssId;
    const audioStream = audioStreams[wssId];
    if (audioStream) {
        console.log(`${wssId}: Streaming AUDIO (MP3) to client...`);
        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Transfer-Encoding', 'chunked');
        audioStream.pipe(res);
    } else {
        console.error(`${wssId}: Failed to stream AUDIO to client: Audio Stream not found.`);
        res.status(400).send({message: `No audio stream available`});
    }
});

app.get('/', (req, res) => {
    res.sendFile('index.html', {root: path.join(__dirname, '/src')});
});

server.listen(port, () => {
    console.log(`WebSocket server listening on port ${port}`);
});