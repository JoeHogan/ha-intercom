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

export const AUDIO_CONFIG = {
    mp3: {
        contentType: 'audio/mpeg',
        audioType: 'music', 
        ffmpeg: [
            // 1. Input Optimization (Minimize startup analysis and buffer size)
            '-rtbufsize', '64k',
            '-probesize', '32',
            '-analyzeduration', '0',
            '-f', 'webm',
            '-i', 'pipe:0', 
            
            // 2. Transcoding Speed Optimization (The most critical flags)
            '-tune', 'zerolatency', // Prioritizes speed and low delay
            '-preset', 'ultrafast', // Fastest possible encoder setting
            '-threads', '1',        // Reduces thread synchronization overhead
            '-c:a', 'libmp3lame',
            
            // 3. Output Configuration
            '-b:a', '64k',            // Lower bitrate minimizes data processed per second
            '-compression_level', '0', // Ensures the fastest compression mode
            
            '-f', 'mp3', // Output format
            '-ar', '44100',
            '-flush_packets', '1', // Forces immediate packet output
            '-'
        ]
    },
    wav: {
        contentType: 'audio/wav',
        audioType: 'music',
        ffmpeg: [
            // 1. Input Optimization
            // '-rtbufsize' should be set first to reserve buffer space immediately.
            '-rtbufsize', '64k',
            '-probesize', '32', 
            '-analyzeduration', '0', 
            '-f', 'webm',
            '-i', 'pipe:0', 
            
            // 2. Output Configuration (WAV/PCM)
            // Ensure no extra CPU-intensive flags are used.
            '-acodec', 'pcm_s16le', // 16-bit signed Little-Endian PCM
            '-f', 'wav',             // WAV container format
            '-ar', '16000',          // Sample rate set to 16000 Hz (16kHz)
            '-ac', '1',              // Mono audio output
            
            // 3. Flushing
            // Forces the output to be written immediately to the pipe.
            '-flush_packets', '1', 
            '-' 
        ]
    }
}

const haUrl = process.env.HOME_ASSISTANT_URL;
const token = process.env.HOME_ASSISTANT_ACCESS_TOKEN;
const audioHost = process.env.AUDIO_HOST;
const audioPoolSize = process.env.AUDIO_POOL_SIZE ? parseInt(process.env.AUDIO_POOL_SIZE) : 2; // For audio streaming
const sttPoolSize = process.env.STT_POOL_SIZE ? parseInt(process.env.STT_POOL_SIZE) : 1; // For STT transcription
const outputType = process.env.OUTPUT_TYPE && ['mp3', 'wav'].indexOf(process.env.OUTPUT_TYPE.toLowerCase().trim()) > -1 ? process.env.OUTPUT_TYPE.toLowerCase().trim() : 'mp3';

const app = express();
const server = http.createServer(app);
const port = 3001;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Global Pools
const ffmpegQueue = [];      // Audio Streaming Pool
const sttFfmpegQueue = [];   // STT Processing Pool

// Active Session Maps
const activeFfmpegSessions = new Map(); // Maps wssId -> Audio Instance
const activeSttSessions = new Map();    // Maps wssId -> STT Instance

// SHARED TRACKING: Global tracking array for ALL active FFMPEG PIDs
const activeFfmpegPIDs = []; 

class ClientSession {
    constructor(config = {}) {
        this.wssId = uuidv4();
        this.id = config.id;
        this.haUrl = haUrl || config.haUrl;
        this.haToken = token || config.haToken;
        this.audioHost = audioHost || config.audioHost || `http://localhost:3001`;
        this.outputType = outputType;
    }
}

const audioStreams = {};

// --- GLOBAL FACTORY AND HELPER FUNCTIONS ---

// Centralized Refill Check for both pools
const checkAndRefillPools = () => {
    // Only proceed if NO FFMPEG processes are currently active (streaming or processing)
    if (activeFfmpegPIDs.length === 0) {
        console.log("Pool replenishment condition met: No active FFMPEG PIDs. Refilling both pools.");
        refillFFmpegPool(); // Refills Audio Pool
        refillSttPool();    // Refills STT Pool
    } else {
        console.log(`Pool refill skipped: ${activeFfmpegPIDs.length} FFMPEG process(es) still active.`);
    }
};

const createFfmpegInstance = () => {
    const ffmpegOutputParams = AUDIO_CONFIG[outputType].ffmpeg;
    const child = spawn('ffmpeg', ffmpegOutputParams);
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
        
        // Remove PID from the global tracking array
        const pidIndex = activeFfmpegPIDs.indexOf(ffmpeg.pid);
        if (pidIndex > -1) {
            activeFfmpegPIDs.splice(pidIndex, 1);
            console.log(`PID ${ffmpeg.pid} removed from active tracking. Remaining PIDs: ${activeFfmpegPIDs.length}`);
        }
        
        // Check and refill pools after killing an instance
        checkAndRefillPools();
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

    const messageWssClients = (message) => {
        const haClients = audioEntities.filter(item => item.entity_id.startsWith('ha_client'));
        if(haClients.length) {
            let haClientIds = haClients.filter(item => !!item.entity_id).map(item => item.entity_id.split('.')[item.entity_id.split('.').length -1]);
            wss.clients.forEach((item) => {
                if(item.clientId && haClientIds.indexOf(item.clientId) > -1) {
                    item.send(message);
                }
            });
        }
    }

    // --- Core Logic Functions ---

    const startAudio = (clientSession) => { 

        const audioClients = audioEntities.filter(item => !item.entity_id.startsWith('ha_client'));

        if(!audioClients.length) {
            return null;
        }

        let currentInstance = ffmpegQueue.pop(); 

        if (!currentInstance) {
            console.warn("Audio Pool empty. Synchronously creating a temporary instance.");
            currentInstance = createFfmpegInstance(); 
        }

        activeFfmpegSessions.set(clientSession.wssId, currentInstance); 
        currentInstance.active = true;
        
        // Add Audio PID to the shared tracking array
        activeFfmpegPIDs.push(currentInstance.pid);

        console.log(`WS ${clientSession.wssId} started AUDIO session with FFMPEG [PID ${currentInstance.pid}]. Active PIDs: ${activeFfmpegPIDs.length}`);
        
        const audioStream = new PassThrough();
        audioStreams[clientSession.wssId] = audioStream; 
        currentInstance.audioStream = audioStream;

        console.log(`${clientSession.wssId}: .${clientSession.outputType} to ${audioEntities.map(({entity_id}) => entity_id).join(', ')}`);

        postAudio(clientSession, audioClients);

        currentInstance.child.stdout.removeAllListeners('data'); 

        currentInstance.child.stdout.on('data', chunk => {
            let buffer = Buffer.from(chunk);
            if (currentInstance.audioStream?.writable) {
                currentInstance.audioStream.write(buffer);
            }
        });
        
        currentInstance.onStdoutEnd = () => {
            if (currentInstance.audioStream?.writable) {
                 console.log(`FFMPEG [PID ${currentInstance.pid}] stdout closed. Ending PassThrough stream.`);
                currentInstance.audioStream.end();
            }
        };
        currentInstance.child.stdout.removeAllListeners('end');
        currentInstance.child.stdout.on('end', currentInstance.onStdoutEnd); 

        const onStreamClose = () => {
            console.log(`PassThrough stream for ${clientSession.wssId} closed.`);
            delete audioStreams[clientSession.wssId];
            currentInstance.child.stdout.removeAllListeners('data');
            if (currentInstance.onStdoutEnd) {
                currentInstance.child.stdout.removeListener('end', currentInstance.onStdoutEnd);
                delete currentInstance.onStdoutEnd;
            }
            delete currentInstance.audioStream;
        };

        audioStream.on('close', onStreamClose);
    };

    const startSTT = (clientSession) => { 

        if((ttsEntities.length + alexaEntities.length) === 0) {
            return null;
        }

        let currentInstance = sttFfmpegQueue.pop(); // Get from dedicated STT pool

        if (!currentInstance) {
            console.warn("STT Pool empty. Synchronously creating a temporary instance.");
            currentInstance = createSttFfmpegInstance();
        }

        activeSttSessions.set(clientSession.wssId, currentInstance);
        currentInstance.active = true;
        
        // Add STT PID to the shared tracking array
        activeFfmpegPIDs.push(currentInstance.pid);
        
        console.log(`WS ${clientSession.wssId} started STT session with FFMPEG [PID ${currentInstance.pid}]. Active PIDs: ${activeFfmpegPIDs.length}`);

        currentInstance.child.stdout.removeAllListeners('end'); 

        currentInstance.child.stdout.on('end', async () => {
            const wavBuffer = Buffer.concat(currentInstance.wavChunks);
            
            currentInstance.wavChunks.length = 0; 
            
            postSTT(wavBuffer)
                .then((res) => {
                    let message = res?.text?.trim();
                    ws.send(encodeMessage({type: 'transcription', text: (message || '[no text]')}));
                    if (message) {
                        if(ttsEntities.length) {
                            console.log(`${clientSession.wssId}: Sending TTS to ${ttsEntities.map(({entity_id}) => entity_id).join(', ')}`);
                            postTTS(clientSession, message, ttsEntities);
                        }
                        if(alexaEntities.length) {
                            console.log(`${clientSession.wssId}: Sending ALEXA TTS to ${alexaEntities.map(({entity_id}) => entity_id).join(', ')}`);
                            postAlexaTTS(clientSession, message, alexaEntities);
                        }
                    }
                })
                .catch(() => ws.send(encodeMessage({type: 'transcription', text: '[error transcribing audio]'})));
        });
        
        return currentInstance;
    };


    const stop = (clientSession) => {
        messageWssClients(encodeMessage({type: 'stop'}));
        // --- STT Cleanup ---
        const sttInstanceToKill = activeSttSessions.get(clientSession.wssId);
        
        if (sttInstanceToKill) {
            if (sttInstanceToKill.input.writable) {
                console.log(`FFMPEG [PID ${sttInstanceToKill.pid}] STT input closed (EOF signal).`);
                sttInstanceToKill.input.end();
            }

            sttInstanceToKill.active = false;
            activeSttSessions.delete(clientSession.wssId);

            // Kill instance after delay (killInstance handles PID removal and pool check)
            setTimeout(() => {
                killInstance(sttInstanceToKill); 
            }, 500); 
        }

        // --- Audio Cleanup ---
        const audioInstanceToKill = activeFfmpegSessions.get(clientSession.wssId);
        
        if (audioInstanceToKill) {
            if (audioInstanceToKill.input.writable) {
                console.log(`FFMPEG [PID ${audioInstanceToKill.pid}] Audio input closed (EOF signal).`);
                audioInstanceToKill.input.end();
            }

            audioInstanceToKill.active = false;
            activeFfmpegSessions.delete(clientSession.wssId);

            if (audioInstanceToKill.onStdoutEnd) {
                audioInstanceToKill.child.stdout.removeListener('end', audioInstanceToKill.onStdoutEnd);
                delete audioInstanceToKill.onStdoutEnd;
            }
            delete audioInstanceToKill.audioStream;

            console.log(`FFMPEG [PID ${audioInstanceToKill.pid}] released. Scheduling Audio cleanup in 5s...`);
            
            // Kill instance after delay (killInstance handles PID removal and pool check)
            setTimeout(() => {
                const audioStream = audioStreams[clientSession.wssId];
                if(audioStream && audioStream.writable) {
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

        let currentTransactionSession = ws.currentTransactionSession;
      
        if(header.type === 'ping') {
            ws.send(encodeMessage({type: 'pong'}));
        }
        
        if(header.type === 'start') {
            currentTransactionSession = new ClientSession({
                id, 
                haUrl, 
                haToken, 
                audioHost
            });
            ws.currentTransactionSession = currentTransactionSession;
            
            setPlayers(header);
            console.log([`Client ID: ${currentTransactionSession.id || 'Not Set'}`, `Session ID: ${currentTransactionSession.wssId}`, `HA Url: ${currentTransactionSession.haUrl}`, `Audio Host Url: ${currentTransactionSession.audioHost}`, `Output Type: ${currentTransactionSession.outputType}`, `HA Token present: ${currentTransactionSession.haToken ? 'TRUE' : 'FALSE'}`].join(' | '));
            
            startAudio(currentTransactionSession); 
            startSTT(currentTransactionSession); 
        }
        
        if(header.type === 'stop') {
            if (!currentTransactionSession) {
                console.warn("Received 'stop' without active session context.");
                return;
            }
            stop(currentTransactionSession); 
            delete ws.currentTransactionSession;
        }
        
        if(header.type === 'audio') {
            if (!currentTransactionSession) {
                return;
            }
            messageWssClients(encodeMessage({type: 'audio', from: currentTransactionSession.id}, payload));

            // const haClients = audioEntities.filter(item => item.entity_id.startsWith('ha_client'));

            // Look up instances using the current unique wssId
            const currentActiveAudioInstance = activeFfmpegSessions.get(currentTransactionSession.wssId);
            const currentActiveSttInstance = activeSttSessions.get(currentTransactionSession.wssId);

            if (currentActiveAudioInstance?.active && currentActiveAudioInstance.input.writable) {
                currentActiveAudioInstance.input.write(payload);
            }
            if (currentActiveSttInstance?.active && currentActiveSttInstance.input.writable) {
                currentActiveSttInstance.input.write(payload);
            }
//             if(haClients.length) {
//                 let haClientIds = haClients.filter(item => !!item.entity_id).map(item => item.entity_id.split('.')[item.entity_id.split('.').length -1]);
//                 wss.clients
//                     .forEach((item) => {
//                         if(item.clientId && haClientIds.indexOf(item.clientId) > -1) {
//                             item.send(encodeMessage({type: 'audio', from: currentTransactionSession.id}, payload));
//                         }
//                     });
//             }
        }
    });

    ws.on('close', (code, reason) => {
        console.log(`Client disconnected: ${code}, ${reason}`);
        
        const closedSession = ws.currentTransactionSession;
        if (!closedSession) return; 
        
        const activeAudioInstance = activeFfmpegSessions.get(closedSession.wssId);
        // killInstance handles removing the PID and checking for pool refill
        if (activeAudioInstance) {
            killInstance(activeAudioInstance);
            activeFfmpegSessions.delete(closedSession.wssId);
        }
        
        const activeSttInstance = activeSttSessions.get(closedSession.wssId);
        if (activeSttInstance) {
            // killInstance handles removing the PID and checking for pool refill
            killInstance(activeSttInstance);
            activeSttSessions.delete(closedSession.wssId);
        }
        
        if (audioStreams[closedSession.wssId]) {
             audioStreams[closedSession.wssId].end();
             delete audioStreams[closedSession.wssId];
        }
        delete ws.currentTransactionSession;
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

Object.keys(AUDIO_CONFIG).forEach(key => {
    app.get(`/listen/:wssId/audio.${key}`, (req, res) => {
        const wssId = req.params.wssId;
        const audioStream = audioStreams[wssId];
        if (audioStream) {
            console.log(`${wssId}: Streaming AUDIO (.${key}) to client...`);
            res.setHeader('Content-Type', `${AUDIO_CONFIG[key].contentType}`);
            res.setHeader('Transfer-Encoding', 'chunked');
            audioStream.pipe(res);
        } else {
            console.error(`${wssId}: Failed to stream AUDIO to client: Audio Stream not found.`);
            res.status(400).send({message: `No audio stream available`});
        }
    });
});

app.get('/', (req, res) => {
    res.sendFile('index.html', {root: path.join(__dirname, '/src')});
});

server.listen(port, () => {
    console.log(`WebSocket server listening on port ${port}`);
});