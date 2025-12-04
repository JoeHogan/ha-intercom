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
import { getMessage } from './server/ws.mjs';

const app = express();
const server = http.createServer(app);
const port = process.env.PORT || 3001;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ClientSession {
    constructor(ws, config = {}) {
        this.wssId = uuidv4();
        this.id = config.id;
        this.haUrl = config.haUrl;
        this.haToken = config.haToken;
        this.audioHost = config.audioHost;
    }
}

const encodeMessage = (header, data = null) => {
  const jsonString = JSON.stringify(header);
  const jsonBuffer = Buffer.from(jsonString, 'utf8');
  const headerLength = jsonBuffer.length;
  const headerLengthBuffer = Buffer.alloc(4);
  headerLengthBuffer.writeUInt32BE(headerLength, 0); 
  let dataBuffer = Buffer.alloc(0);
  if (data) {
      dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  }
  return Buffer.concat([
    headerLengthBuffer,
    jsonBuffer,
    dataBuffer
  ]);
}

app.use(express.static('custom_components/ha_intercom/www'));

const wss = new WebSocketServer({ noServer: true });

const audioStreams = {};

wss.on('connection', (ws, request) => {
    console.log('WebSocket client connected');

    let ffmpegAudio;
    let ffmpegSTT;
    let audioEntities;
    let ttsEntities;
    let alexaEntities;
    const url = new URL(request.url, `http://localhost:${port}`);
    const id = url.searchParams.get('id');
    const haUrl = url.searchParams.get('haUrl');
    const haToken = url.searchParams.get('haToken');
    const audioHost = url.searchParams.get('audioHost');
    ws.clientId = id;

    const getEntitesByType = (targets, type) => {
        type = (type || '').toLowerCase();
        return targets.filter(item => item.type.toLowerCase().trim() === type);
    };

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
            .filter((item, i, arr) => arr.findIndex(ai => ai.entity_id === item.entity_id) === i); // remove duplicate entities
        audioEntities = getEntitesByType(targets, 'audio');
        ttsEntities = getEntitesByType(targets, 'tts');
        alexaEntities = getEntitesByType(targets, 'alexa');
    };

    // const startAudio = (client) => {

    //     if(!audioEntities.length) {
    //         return null;
    //     }

    //     const audioStream = new PassThrough();
    //     audioStreams[client.wssId] = audioStream;

    //     console.log(`${client.wssId}: Sending AUDIO to ${audioEntities.map(({entity_id}) => entity_id).join(', ')}`);

    //     postAudio(client, audioEntities);

    //     const instance = spawn('ffmpeg', [
    //         '-f', 'webm',
    //         '-i', 'pipe:0',
    //         '-f', 'mp3',
    //         '-acodec', 'libmp3lame',
    //         '-ar', '44100',
    //         '-'
    //     ]);
    //     // Output MP3 stream chunks to console or broadcast
    //     instance.stdout.on('data', chunk => {
    //         // You could broadcast this to other WebSocket clients or save it
    //         audioStream.write(Buffer.from(chunk));
    //     });

    //     instance.stderr.on('data', data => {
    //         console.error('ffmpeg:', data.toString());
    //     });

    //     instance.on('close', code => {
    //         console.log('ffmpeg exited with code', code);
    //         audioStream.end();
    //         delete audioStreams[client.wssId];
    //     });

    //     return instance;
    // };

    const startAudio = (client) => {

        if(!audioEntities.length) {
            return null;
        }

        const audioStream = new PassThrough();
        audioStreams[client.wssId] = audioStream;

        console.log(`${client.wssId}: Sending AUDIO (MP3) to ${audioEntities.map(({entity_id}) => entity_id).join(', ')}`);

        let haClients = audioEntities.filter(item => item.entity_id.startsWith('ha_client'));
        let audioClients = audioEntities.filter(item => !item.entity_id.startsWith('ha_client'));
        postAudio(client, audioClients);

        const instance = spawn('ffmpeg', [
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
        
        // Output MP3 stream chunks
        instance.stdout.on('data', chunk => {
            let buffer = Buffer.from(chunk);
            audioStream.write(buffer);
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

        instance.stderr.on('data', data => {
            console.error('ffmpeg:', data.toString());
        });

        instance.on('close', code => {
            console.log('ffmpeg exited with code', code);
            audioStream.end();
            delete audioStreams[client.wssId];
        });

        return instance;
    };

    const startSTT = (client) => {

        if((ttsEntities.length + alexaEntities.length) === 0) {
            return null;
        }

        const wavChunks = [];

        const instance = spawn('ffmpeg', [
            '-f', 'webm',         // input format
            '-i', 'pipe:0',       // read from stdin
            '-ac', '1',           // mono
            '-ar', '16000',       // 16kHz
            '-f', 'wav',          // output format
            'pipe:1'              // write to stdout
        ]);
        // Output MP3 stream chunks to console or broadcast
        instance.stdout.on('data', chunk => {
            wavChunks.push(chunk);
        });

        instance.stdout.on('end', async () => {
            const wavBuffer = Buffer.concat(wavChunks);
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

        instance.stderr.on('data', data => {
            console.error('ffmpeg:', data.toString());
        });

        instance.on('close', code => {
            console.log('ffmpeg exited with code', code);
        });

        return instance;
    };

    const killInstance = (ffmpeg) => {
        ffmpeg.stdin.end();
        ffmpeg.kill();
        ffmpeg = null;
    };

    const stop = () => {
        if (ffmpegAudio) {
            killInstance(ffmpegAudio);
        }
        if (ffmpegSTT) {
            killInstance(ffmpegSTT);
        }
    };

    ws.on('message', data => {

        const {header, payload} = getMessage(data);
      
        if(header.type === 'start') {
            setPlayers(header);
            const client = new ClientSession({id, haUrl, haToken, audioHost});
            ffmpegAudio = startAudio(client);
            ffmpegSTT = startSTT(client);
        }
        if(header.type === 'stop') {
            stop();
        }
        if(header.type === 'data') {
            if (ffmpegAudio?.stdin?.writable) {
                ffmpegAudio.stdin.write(payload);
            }
            if (ffmpegSTT?.stdin?.writable) {
                ffmpegSTT.stdin.write(payload);
            }
        }
    });

    ws.on('close', (code, reason) => {
        console.log(`Client disconnected: ${code}, ${reason}`);
    });

});

// Only upgrade if request is for the correct path
server.on('upgrade', (request, socket, head) => {
  if (request.url.startsWith('/api/ha_intercom/ws')) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// app.get('/listen/:wssId', (req, res) => {
//     const wssId = req.params.wssId;
//     const audioStream = audioStreams[wssId];
//     if (audioStream) {
//         console.log(`${wssId}: Streaming AUDIO to client...`);
//         res.setHeader('Content-Type', 'music');
//         res.setHeader('Transfer-Encoding', 'chunked');
//         audioStream.pipe(res);
//     } else {
//         console.error(`${wssId}: Failed to stream AUDIO to client: Audio Stream not found.`);
//         res.status(400).send({message: `No audio stream available`});
//     }
// });

app.get('/listen/:wssId', (req, res) => {
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
