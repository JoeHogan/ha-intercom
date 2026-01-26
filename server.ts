import 'dotenv/config';
import express from 'express';
import http from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer, WebSocket } from 'ws';
import * as mediasoup from 'mediasoup';
import { addKnownClient, getKnownClients } from './server/controllers/config.ts';
import { AUDIO_CONFIG, initializeFFmpegPools, outputType } from './server/controllers/ffmpeg.ts';
import type { Entity, RoomState } from './server/models/interfaces.ts';
import { setPlayers, startAudio, startSTT } from './server/controllers/audio.ts';

function getLocalIp(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]!) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

const PORT = 3001;
const ANNOUNCED_IP = process.env.WEBRTC_HOST_IP || getLocalIp();
const ICE_SERVERS = process.env.TURN_SERVER_URL
  ? [{ urls: process.env.TURN_SERVER_URL, username: process.env.TURN_USERNAME, credential: process.env.TURN_PASSWORD }]
  : [{ urls: 'stun:stun.l.google.com:19302' }];

const HA_URL = process.env.HOME_ASSISTANT_URL;
const HA_TOKEN = process.env.HOME_ASSISTANT_ACCESS_TOKEN;
const AUDIO_HOST = process.env.AUDIO_HOST;
const DEBUG = process.env.DEBUG?.toString().toLowerCase().trim() === 'true' ? true : false;

const MEDIA_CODECS: mediasoup.types.RtpCodecCapability[] = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2,
    preferredPayloadType: 111
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: { 'x-google-start-bitrate': 1000 },
    preferredPayloadType: 96,
    rtcpFeedback: [
      { type: 'nack' },
      { type: 'nack', parameter: 'pli' },
      { type: 'ccm', parameter: 'fir' },
      { type: 'goog-remb' },
      { type: 'transport-cc' },
    ],
  },
];

const rooms = new Map<string, RoomState>();
let worker: mediasoup.types.Worker;

initializeFFmpegPools();

(async () => {
  worker = await mediasoup.createWorker({
    ...(DEBUG ? {
      logLevel: 'debug',
      logTags: ['info', 'ice', 'dtls', 'rtp', 'rtcp']
    } : {}),
    rtcMinPort: 10000,
    rtcMaxPort: 10100,
  });
})();

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
const knownClients = await getKnownClients();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const handleConnection = (ws: WebSocket, request) => {
  console.log('WebSocket client connected');

  const url = new URL(request.url, `http://localhost:${PORT}`);
  const userId = url.searchParams.get('id')!;
  const haUrl = url.searchParams.get('haUrl');
  const haToken = url.searchParams.get('haToken');
  const audioHost = url.searchParams.get('audioHost');

  const sendClients = () => {
    let allClients = [];
    wss.clients.forEach((ws: any) => {
      if (ws.client) {
        allClients.push({ ...ws.capabilities, ...ws.client });
      }
    });

    wss.clients.forEach((ws: any) => {
      let clients = allClients
        .sort((a, b) => a.name.localeCompare(b.name))
        .filter(client => client.entity_id !== ws.client?.entity_id)
        .filter((client, i, arr) => arr.findIndex(ai => ai.entity_id === client.entity_id) === i);
      ws.send(JSON.stringify({ type: 'clients', clients }));
    });
  };

  const emitToTargets = (entities: Entity[], msg: { [key: string]: any }) => {
    wss.clients.forEach((ws: any) => {
      let entity = entities.find((ent: Entity) => ws.client?.entity_id && ent.entity_id === ws.client.entity_id);
      if (entity) {
        let from = { ...(msg.from || {}), type: entity.type }
        ws.send(JSON.stringify({ ...msg, from }));
      }
    });
  };

  const setClientConfig = (clientConfig) => {
    (ws as any).client = clientConfig;
    ws.send(JSON.stringify({ type: 'updateConfig', ...clientConfig }));
    sendClients();
  }

  if (knownClients[userId]) {
    setClientConfig(knownClients[userId]);
  } else {
    ws.send(JSON.stringify({ type: 'setup' }));
  }

  ws.send(JSON.stringify({ type: 'config', iceServers: ICE_SERVERS }));

  ws.on('message', async (data: string) => {
    let msg: any = {};
    try { msg = JSON.parse(data); } catch (e) { }
    const { type, name, entity_id, targets, roomId, kind, producerId, dtlsParameters, rtpCapabilities, rtpParameters, consumerId } = msg;

    const joinRoom = (roomId, isInitiator = false) => {
      const room = rooms.get(roomId!)!
      const clientData = {
        ws: ws,
        transports: new Map(),
        producers: new Map(),
        consumers: new Map(),
        isInitiator
      };
      room.clients.set(userId, clientData);
      return room;
    }

    switch (type) {
      case 'create': {
        if (!rooms.has(roomId!)) {
          const router = await worker.createRouter({ mediaCodecs: MEDIA_CODECS });
          rooms.set(roomId!, {
            id: roomId,
            router,
            hostProducerId: userId,
            ffmpeg: { audio: null, stt: null },
            clients: new Map(),
            targets,
            entities: { video: [], audio: [], stt: [], alexa: [] },
            environment: {
              haUrl: HA_URL || haUrl,
              audioHost: AUDIO_HOST || audioHost || `http://localhost:${PORT}`,
              haToken: HA_TOKEN || haToken
            }
          });
        }
        const room = joinRoom(roomId, true);
        ws.send(JSON.stringify({
          type: 'roomCreated',
          roomId: room.id,
          routerRtpCapabilities: room.router.rtpCapabilities
        }));
        ws.send(JSON.stringify({
          type: 'roomJoined',
          routerRtpCapabilities: room.router.rtpCapabilities,
          roomId: room.id
        }));
        emitToTargets(targets, {
          type: 'incomingMedia',
          roomId: room.id,
          from: (ws as any).client
        });
        break;
      }
      case 'join': {
        const room = joinRoom(roomId, false);
        ws.send(JSON.stringify({
          type: 'roomJoined',
          roomId: room.id,
          routerRtpCapabilities: room.router.rtpCapabilities
        }));

        // Notify joining user about existing producers with full metadata
        room.clients.forEach((client, otherUserId) => {
          if (otherUserId !== userId) {
            client.producers.forEach(p => {
              const otherWs = client.ws as any;
              const from = { ...(otherWs.client || {}), type: client.mediaType };
              ws.send(JSON.stringify({
                type: 'newProducer',
                producerId: p.id,
                kind: p.kind,
                from
              }));
            });
          }
        });
        break;
      }
      case 'createTransport': {
        const room = rooms.get(roomId!)!;
        const transport = await room.router.createWebRtcTransport({
          listenInfos: [
            { protocol: 'udp', ip: '0.0.0.0', announcedAddress: ANNOUNCED_IP },
            { protocol: 'tcp', ip: '0.0.0.0', announcedAddress: ANNOUNCED_IP }
          ],
          enableUdp: true,
          enableTcp: true
        });

        room.clients.get(userId)!.transports.set(transport.id, transport);

        ws.send(JSON.stringify({
          type: 'transportCreated',
          roomId: room.id,
          direction: msg.direction,
          params: {
            id: transport.id,
            iceParameters: transport.iceParameters,
            iceCandidates: transport.iceCandidates,
            dtlsParameters: transport.dtlsParameters
          }
        }));
        break;
      }

      case 'connectTransport': {
        const room = rooms.get(roomId!)!;
        const client = room.clients.get(userId)!;
        const transport = client.transports.get(msg.transportId);
        if (transport) {
          await transport.connect({ dtlsParameters });
          ws.send(JSON.stringify({ type: 'transportConnected', transportId: msg.transportId }));
        }
        break;
      }

      case 'produce': {
        const room = rooms.get(roomId!)!;
        const client = room.clients.get(userId)!;
        client.mediaType = msg.mediaType;
        const transport = client.transports.get(msg.transportId);
        if (!transport) return;

        const producer = await transport.produce({ kind, rtpParameters });
        client.producers.set(producer.id, producer);

        ws.send(JSON.stringify({ type: 'producerCreated', producerId: producer.id }));

        // Notify everyone else in the room
        room.clients.forEach((otherClient, otherUserId) => {
          if (otherUserId !== userId) {
            const from = { ...((ws as any).client || {}), type: client.mediaType };
            otherClient.ws.send(JSON.stringify({ type: 'newProducer', producerId: producer.id, kind, from }));
          }
        });

        if (kind === 'audio' && client.isInitiator) {
          startRecording(roomId!, producer.id, room.router);
        }
        break;
      }

      case 'consume': {
        const room = rooms.get(roomId!)!;
        const client = room.clients.get(userId)!;
        if (!room.router.canConsume({ producerId, rtpCapabilities })) return;

        // If transportId is provided use it, otherwise fallback
        const transport = msg.transportId ? client.transports.get(msg.transportId) : client.transports.values().next().value;
        if (!transport) return;

        const consumer = await transport.consume({ producerId, rtpCapabilities, paused: true });
        client.consumers.set(consumer.id, consumer);

        ws.send(JSON.stringify({
          type: 'consumed',
          params: { id: consumer.id, producerId, kind: consumer.kind, rtpParameters: consumer.rtpParameters }
        }));
        break;
      }

      case 'hangup': {
        const room = rooms.get(roomId!);
        if (room) {
          // If the one who hanged up was participating, close entire room.
          // For Intercom, normally hangup closes the room for everyone.
          cleanupRoom(roomId!);
        }
        break;
      }

      case 'resumeConsumer': {
        const room = rooms.get(roomId!)!;
        const client = room.clients.get(userId)!;
        const consumer = client.consumers.get(consumerId);
        if (consumer) await consumer.resume();
        break;
      }

      case 'ping': { ws.send(JSON.stringify({ type: 'pong' })); break; }

      case 'updateConfig': {
        let updatedConfigItem = await addKnownClient(userId, { name, entity_id });
        knownClients[userId] = updatedConfigItem;
        setClientConfig(updatedConfigItem);
        break;
      }

      case 'register': {
        (ws as any).capabilities = { video: msg.video || false };
        if (msg.name && msg.entity_id) {
          const clientConfig = { name: msg.name, entity_id: msg.entity_id };
          (ws as any).client = clientConfig;
        }
        sendClients();
        break;
      }
    }
  });

  ws.on('close', () => {
    for (const [key, room] of rooms) {
      if (room.clients.has(userId)) {
        cleanupRoom(key);
      }
    }
  });

  function cleanupRoom(roomId: string) {
    const room = rooms.get(roomId);
    if (!room) return;

    console.log(`Cleaning up room: ${roomId}`);

    // Notify all clients and close their socket associations in this room
    room.clients.forEach((client, cid) => {
      try {
        if (client.ws.readyState === WebSocket.OPEN) {
          client.ws.send(JSON.stringify({ type: 'roomClosed', roomId }));
        }
      } catch (e) {
        console.error('Error notifying client of room close:', e);
      }
      // Mediasoup objects (transports, producers, consumers) are closed when the router or transport is closed.
      // Explicitly closing them is safer and avoids relying on GC order.
      client.producers.forEach(p => p.close());
      client.consumers.forEach(c => c.close());
      client.transports.forEach(t => t.close());
    });

    // Close the router - this automatically closes all associated transports/producers/consumers
    try {
      room.router.close();
    } catch (e) {
      console.error('Error closing router:', e);
    }

    // Stop recording/FFmpeg
    stopRecording(roomId);

    // Remove from rooms map
    rooms.delete(roomId);
  }
};

wss.on('connection', handleConnection);

server.on('upgrade', (request, socket, head) => {
  if (request.url.startsWith('/api/ha_intercom/ws')) {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// --- RECORDING LOGIC ---
async function startRecording(roomId: string, producerId: string, router: any) {
  const room = rooms.get(roomId);
  if (!room) return;

  const transport = await router.createPlainTransport({
    listenInfo: { protocol: 'udp', ip: '0.0.0.0', announcedAddress: ANNOUNCED_IP },
    rtcpMux: true, comedia: false
  });

  const rtpPort = Math.floor(Math.random() * 5000) + 20000;
  console.log(`RTP Port: ${rtpPort}`);
  await transport.connect({ ip: ANNOUNCED_IP, port: rtpPort });

  const consumer = await transport.consume({ producerId, rtpCapabilities: router.rtpCapabilities, paused: false });
  await consumer.resume();

  const sdpString = `v=0
    o=- 0 0 IN IP4 ${ANNOUNCED_IP}
    s=Mediasoup
    c=IN IP4 ${ANNOUNCED_IP}
    t=0 0
    m=audio ${rtpPort} RTP/AVP ${consumer.rtpParameters.codecs[0].payloadType}
    a=rtpmap:${consumer.rtpParameters.codecs[0].payloadType} opus/48000/2
    a=fmtp:${consumer.rtpParameters.codecs[0].payloadType} useinbandfec=1
  `;

  setPlayers(room);
  console.log([`Client ID: ${room.hostProducerId || 'Not Set'}`, `Session ID: ${room.id}`, `HA Url: ${room.environment.haUrl}`, `Audio Host Url: ${room.environment.audioHost}`, `Output Type: ${outputType}`, `HA Token present: ${room.environment.haToken ? 'TRUE' : 'FALSE'}`].join(' | '));

  startAudio(room, sdpString);
  startSTT(room, sdpString);

  if (room.ffmpeg.audio) {
    room.ffmpeg.audio.child.on('close', (code) => {
      console.log(`[FFMPEG] Audio Process exited with code ${code} for room ${roomId}`);
      transport.close();
    });
  }

  if (room.ffmpeg.stt) {
    room.ffmpeg.stt.child.on('close', (code) => {
      console.log(`[FFMPEG] STT Process exited with code ${code} for room ${roomId}`);
      transport.close();
    });
  }
}

function stopRecording(roomId: string) {
  const room = rooms.get(roomId);
  if (room) {
    if (room.ffmpeg.audio) {
      room.ffmpeg.audio.child.kill('SIGKILL');
      room.ffmpeg.audio = null;
    }
    if (room.ffmpeg.stt) {
      room.ffmpeg.stt.child.kill('SIGKILL');
      room.ffmpeg.stt = null;
    }
  }
}

app.use(express.static('custom_components/ha_intercom/www'));

Object.keys(AUDIO_CONFIG).forEach(key => {
  app.get(`/listen/:roomId/audio.${key}`, (req, res) => {
    const roomId = req.params.roomId;
    const room = rooms.get(roomId);

    if (room && room.ffmpeg.audio) {
      const activeAudioSession = room.ffmpeg.audio;
      console.log(`${roomId}: Streaming AUDIO (.${key}) to client...`);
      res.setHeader('Content-Type', `${AUDIO_CONFIG[key].contentType}`);
      res.setHeader('Transfer-Encoding', 'chunked');
      activeAudioSession.output.pipe(res);
      res.on('finish', () => {
        console.log(`Finished streaming audio to ${roomId}.`);
      });
    } else {
      console.error(`${roomId}: Failed to stream AUDIO to client: Audio Stream not found.`);
      res.status(400).send({ message: `No audio stream available` });
    }
  });
});

app.get('/', (req, res) => {
  res.sendFile('index.html', { root: path.join(__dirname, '/src') });
});

server.listen(PORT, () => {
  console.log(`Server on ${PORT}, Media IP: ${ANNOUNCED_IP}`);
});