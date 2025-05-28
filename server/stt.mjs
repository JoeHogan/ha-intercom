import net from 'net';

const CHUNK_SIZE = 4096;
const SAMPLE_RATE = 16000;
const SAMPLE_WIDTH = 2;
const CHANNELS = 1;

const whisperHost = process.env.WHISPER_HOST || 'localhost';
const whisperPort = process.env.WHISPER_PORT || 10300;

/**
 * Builds and sends a complete Wyoming message (header + optional data + optional payload)
 */
function sendWyomingMessage(socket, type, data = {}, payload = null) {
  const dataStr = Object.keys(data).length > 0 ? JSON.stringify(data) : null;
  const dataBuffer = dataStr ? Buffer.from(dataStr, 'utf8') : Buffer.alloc(0);
  const payloadBuffer = payload || Buffer.alloc(0);

  const header = {
    type,
    ...(dataStr && { data_length: dataBuffer.length }),
    ...(payload && { payload_length: payloadBuffer.length })
  };

  const headerStr = JSON.stringify(header) + '\n';
  socket.write(headerStr);
  if (dataBuffer.length > 0) socket.write(dataBuffer);
  if (payloadBuffer.length > 0) socket.write(payloadBuffer);
}

export async function postSTT(wavBuffer) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let resolved = false;

    socket.connect(whisperPort, whisperHost, () => {
      const pcmData = wavBuffer.subarray(44);
      const totalSamples = pcmData.length / SAMPLE_WIDTH;
      const samplesPerChunk = CHUNK_SIZE / SAMPLE_WIDTH;

      // 1. Send audio-start
      sendWyomingMessage(socket, 'audio-start', {
        rate: SAMPLE_RATE,
        width: SAMPLE_WIDTH,
        channels: CHANNELS,
        timestamp: 0
      });

      // 2. Send audio-chunks
      for (let i = 0; i < totalSamples; i += samplesPerChunk) {
        const byteOffset = i * SAMPLE_WIDTH;
        const chunk = pcmData.subarray(byteOffset, byteOffset + CHUNK_SIZE);
        const timestamp = Math.floor((i / SAMPLE_RATE) * 1000); // in ms

        sendWyomingMessage(socket, 'audio-chunk', {
          rate: SAMPLE_RATE,
          width: SAMPLE_WIDTH,
          channels: CHANNELS,
          timestamp
        }, chunk);
      }

      // 3. Send audio-stop
      const stopTimestamp = Math.floor((totalSamples / SAMPLE_RATE) * 1000);
      sendWyomingMessage(socket, 'audio-stop', {
        rate: SAMPLE_RATE,
        width: SAMPLE_WIDTH,
        channels: CHANNELS,
        timestamp: stopTimestamp
      });
    });

    socket.on('data', (data) => {
      let responseBuffer = data.toString();

      let lines = responseBuffer.split('\n');

      let transcription;

      try {
        transcription = lines.length ? JSON.parse(lines[lines.length - 1]) : null;
        if(transcription?.text) {
            console.log(`Transcription: ${transcription.text}`);
        }
      } catch (e) {
        console.error(`
            Error parsing transcription response.
            Response: ${responseBuffer}
            Error: ${e}
        `)
      }

      resolve(transcription);
      socket.end();

    });

    socket.on('error', (err) => {
      if (!resolved) {
        resolved = true;
        reject(err);
      }
    });

    socket.on('end', () => {
      if (!resolved) {
        resolved = true;
        reject(new Error('Disconnected before transcription received'));
      }
    });
  });
}