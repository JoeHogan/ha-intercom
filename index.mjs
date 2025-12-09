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
            // '-fflags', 'nobuffer',
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
const stopDelay = 5000;

const app = express();
const server = http.createServer(app);
const port = 3001;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Global Pools
const ffmpegQueue = [];      // Audio Streaming Pool
const sttFfmpegQueue = [];   // STT Processing Pool

// Active Session Maps
const activeAudioSessions = new Map(); // Maps wssId -> Audio Instance
const activeSttSessions = new Map();  // Maps wssId -> STT Instance
const audioStreams = new Map(); // Maps wssId -> HTTP Audio Stream

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

// --- GLOBAL FACTORY AND HELPER FUNCTIONS ---

// Centralized Refill Check for both pools
const checkAndRefillPools = () => {
    // Only proceed if NO FFMPEG processes are currently active (streaming or processing)
    if (activeFfmpegPIDs.length === 0) {
        console.log("Pool replenishment condition met: No active FFMPEG PIDs. Refilling both pools.");
        refillFFmpegPool(); // Refills Audio Pool
        refillSttPool();  // Refills STT Pool
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

const killFfmpegInstance = (wssId, activeFfmpegSessions, delay = stopDelay) => {

    // let instanceToKill = activeFfmpegSessions.get(wssId);
    // if (instanceToKill) {
    //     instanceToKill.active = false;
    //     if (instanceToKill.input?.writable) {
    //         console.log(`FFMPEG [PID ${instanceToKill.pid}] input closed (EOF signal).`);
    //         instanceToKill.input.stdin.end();
    //     }
    //     // if (instanceToKill.child?.stdin) {
    //     //     console.log(`FFMPEG [PID ${instanceToKill.pid}] child input closed (EOF signal).`);
    //     //     instanceToKill.child.stdin.end();
    //     // }
    // }
            
    setTimeout(() => {
        const instanceToKill = activeFfmpegSessions.get(wssId);
        if (instanceToKill) {
            instanceToKill.active = false;
            if (instanceToKill.input?.writable) {
                console.log(`FFMPEG [PID ${instanceToKill.pid}] input closed (EOF signal).`);
                instanceToKill.input.end();
            }
            if (instanceToKill.child?.stdin) {
                console.log(`FFMPEG [PID ${instanceToKill.pid}] child input closed (EOF signal).`);
                instanceToKill.child.stdin.end();
            }

            activeFfmpegSessions.delete(wssId);

            instanceToKill.child.kill('SIGKILL');
            console.log(`FFMPEG [PID ${instanceToKill.pid}] forcefully terminated.`);
                
            // Remove PID from the global tracking array
            const pidIndex = activeFfmpegPIDs.indexOf(instanceToKill.pid);
            if (pidIndex > -1) {
                activeFfmpegPIDs.splice(pidIndex, 1);
                console.log(`PID ${instanceToKill.pid} removed from active tracking. Remaining PIDs: ${activeFfmpegPIDs.length}`);
            }
            
            if (instanceToKill.onStdoutEnd) {
                instanceToKill.child.stdout.removeListener('end', instanceToKill.onStdoutEnd);
                delete instanceToKill.onStdoutEnd;
            }
        }
        // Check and refill pools after killing an instance
        checkAndRefillPools();
    }, delay);
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

const removeAudioStream = (wssId, delay = stopDelay) => {
    const audioStream = audioStreams.get(wssId);
    if(audioStream) {
        if(audioStream.writable) {
            console.log(`Ending audio stream for ${wssId} and scheduling removal in ${delay}ms...`)
            audioStream.end(); 
        }
        setTimeout(() => {
            const audioStream = audioStreams.get(wssId);
            if(audioStream) { // check again after delay
                console.log(`Removing audio stream for ${wssId}`);
                audioStreams.delete(wssId);
            }
        }, delay);
    }
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

        activeAudioSessions.set(clientSession.wssId, currentInstance); 
        currentInstance.active = true;

        // Add Audio PID to the shared tracking array
        activeFfmpegPIDs.push(currentInstance.pid);

        console.log(`WS ${clientSession.wssId} started AUDIO session with FFMPEG [PID ${currentInstance.pid}]. Active PIDs: ${activeFfmpegPIDs.length}`);
        
        const audioStream = new PassThrough();
        audioStreams.set(clientSession.wssId, audioStream); 

        console.log(`${clientSession.wssId}: .${clientSession.outputType} to ${audioEntities.map(({entity_id}) => entity_id).join(', ')}`);

        postAudio(clientSession, audioClients); 

        currentInstance.child.stdout.removeAllListeners('data'); 

        currentInstance.child.stdout.on('data', chunk => {
            let buffer = Buffer.from(chunk);
            if (audioStream?.writable) {
                audioStream.write(buffer);
            }
        });
    
        currentInstance.onStdoutEnd = () => {
            if (audioStream?.writable) {
                console.log(`FFMPEG [PID ${currentInstance.pid}] stdout closed. Ending PassThrough stream.`);
                audioStream.end();
            }
        };
        currentInstance.child.stdout.removeAllListeners('end');
        currentInstance.child.stdout.on('end', currentInstance.onStdoutEnd); 

        const onStreamClose = () => {
            console.log(`PassThrough stream for ${clientSession.wssId} closed.`);
            currentInstance.child.stdout.removeAllListeners('data');
            if (currentInstance.onStdoutEnd) {
                currentInstance.child.stdout.removeListener('end', currentInstance.onStdoutEnd);
                delete currentInstance.onStdoutEnd;
            }
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

    const scheduleStop = (wssId, delay = stopDelay) => {
        
        messageWssClients(encodeMessage({type: 'stop'}));

        console.log(`Scheduling audio processing stop in ${delay}ms...`);

        // --- STT Cleanup ---
        killFfmpegInstance(wssId, activeSttSessions, delay);
        
        // --- Audio Cleanup ---
        killFfmpegInstance(wssId, activeAudioSessions, delay);
        
        // --- HTTP Audio Stream Cleanup ---

        removeAudioStream(wssId, delay);

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
            scheduleStop(currentTransactionSession.wssId); 
            delete ws.currentTransactionSession;
        }
            
        if(header.type === 'audio') {
            if (!currentTransactionSession) {
                return;
            }
            messageWssClients(encodeMessage({type: 'audio', from: currentTransactionSession.id}, payload));

            // Look up instances using the current unique wssId
            const currentActiveAudioInstance = activeAudioSessions.get(currentTransactionSession.wssId);
            const currentActiveSttInstance = activeSttSessions.get(currentTransactionSession.wssId);

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
    
        const closedSession = ws.currentTransactionSession;
        if (closedSession) {
            scheduleStop(closedSession.wssId);
            delete ws.currentTransactionSession;
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

Object.keys(AUDIO_CONFIG).forEach(key => {
    app.get(`/listen/:wssId/audio.${key}`, (req, res) => {
      const wssId = req.params.wssId;
      const audioStream = audioStreams.get(wssId);
      if (audioStream) {
        console.log(`${wssId}: Streaming AUDIO (.${key}) to client...`);
        res.setHeader('Content-Type', `${AUDIO_CONFIG[key].contentType}`);
        res.setHeader('Transfer-Encoding', 'chunked');
        audioStream.pipe(res);
        res.on('finish', () => {
            console.log(`Finished streaming audio to ${wssId}.`);
            removeAudioStream(wssId, 0); // no need for delay here because all audio data has been sent to client
        });
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