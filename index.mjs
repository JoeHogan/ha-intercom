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
    constructor(config = {}) {
        this.wssId = uuidv4();
        this.haUrl = config.haUrl;
        this.haToken = config.haToken;
    }
}

app.use(express.static('custom_components/ha_intercom/www'));

const wss = new WebSocketServer({ noServer: true });

const audioStreams = {};

wss.on('connection', ws => {
    console.log('WebSocket client connected');

    let ffmpegAudio;
    let ffmpegSTT;
    let audioEntities;
    let ttsEntities;
    let alexaEntities;

    const getEntitesByType = (targets, type) => {
        type = (type || '').toLowerCase();
        return targets.filter(item => item.type.toLowerCase().trim() === type);
    };

    const setPlayers = (header) => {
        let targets = (header.target || [])
            .filter(item => !!item?.entity_id && !!item.type)
            .map(item => {
                item.type = item.type.trim().toLowerCase();
                item.entity_id = item.entity_id.trim();
                return item;
            })
            .filter((item, i, arr) => arr.findIndex(ai => ai.entity_id === item.entity_id) === i); // remove duplicate entities
        audioEntities = getEntitesByType(targets, 'audio');
        ttsEntities = getEntitesByType(targets, 'tts');
        alexaEntities = getEntitesByType(targets, 'alexa');
    };

    const startAudio = (client) => {

        if(!audioEntities.length) {
            return null;
        }

        const audioStream = new PassThrough();
        audioStreams[client.wssId] = audioStream;

        console.log(`${client.wssId}: Sending AUDIO to ${audioEntities.map(({entity_id}) => entity_id).join(', ')}`);

        postAudio(client, audioEntities);

        const instance = spawn('ffmpeg', [
            '-f', 'webm',
            '-i', 'pipe:0',
            '-f', 'mp3',
            '-acodec', 'libmp3lame',
            '-ar', '44100',
            '-'
        ]);
        // Output MP3 stream chunks to console or broadcast
        instance.stdout.on('data', chunk => {
            // You could broadcast this to other WebSocket clients or save it
            audioStream.write(Buffer.from(chunk));
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
                    ws.send(message || '[no text]');
                    if (message) {
                        if(ttsEntities.length) {
                            console.log(`${client.wssId}: Sending TTS to ${ttsEntities.map(({entity_id}) => entity_id).join(', ')}`);
                            // postTTS(client, message, ttsEntities);
                        }
                        if(alexaEntities.length) {
                            console.log(`${client.wssId}: Sending ALEXA TTS to ${alexaEntities.map(({entity_id}) => entity_id).join(', ')}`);
                            // postAlexaTTS(client, message, alexaEntities);
                        }
                    }
                })
                .catch(() => ws.send("[error transcribing audio]"));
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
            const client = new ClientSession();
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

app.get('/listen/:wssId', (req, res) => {
    const wssId = req.params.wssId;
    const audioStream = audioStreams[wssId];
    if (audioStream) {
        console.log(`${wssId}: Streaming AUDIO to client...`);
        res.setHeader('Content-Type', 'music');
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
