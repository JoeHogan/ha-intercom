import { spawn } from "child_process";
import { PassThrough } from "stream";

const audioPoolSize = process.env.AUDIO_POOL_SIZE ? parseInt(process.env.AUDIO_POOL_SIZE) : 2; // For audio streaming
const sttPoolSize = process.env.STT_POOL_SIZE ? parseInt(process.env.STT_POOL_SIZE) : 1; // For STT transcription
export const outputType = process.env.OUTPUT_TYPE && ['mp3', 'wav'].indexOf(process.env.OUTPUT_TYPE.toLowerCase().trim()) > -1 ? process.env.OUTPUT_TYPE.toLowerCase().trim() : 'mp3';
const stopDelay = 5000;

// Global Pools
export const ffmpegQueue = [];      // Audio Streaming Pool
export const sttFfmpegQueue = [];   // STT Processing Pool

// SHARED TRACKING: Global tracking array for ALL active FFMPEG PIDs
const activeFfmpegPIDs = [];

const ffmpegMp3Args = [
    '-protocol_whitelist', 'pipe,udp,rtp',
    '-f', 'sdp',
    '-i', 'pipe:0',
    '-fflags', '+nobuffer+igndts',
    '-probesize', '32',
    '-analyzeduration', '0',
    '-acodec', 'libmp3lame',
    '-ar', '16000',
    '-ac', '1',
    '-ab', '64k',
    '-flush_packets', '1',
    '-f', 'mp3',
    'pipe:1'
];

const ffmpegWavArgs = [
    '-protocol_whitelist', 'pipe,udp,rtp',
    '-f', 'sdp',
    '-i', 'pipe:0',
    '-fflags', '+nobuffer+igndts',
    '-probesize', '32',
    '-analyzeduration', '0',
    '-acodec', 'pcm_s16le',
    '-ar', '16000', // required for espHome
    '-ac', '1',
    '-af', 'aresample=matrix_encoding=dplii', 
    '-flush_packets', '1',
    '-f', 'wav',
    'pipe:1'
];

export const AUDIO_CONFIG = {
    mp3: {
        contentType: 'audio/mpeg',
        audioType: 'music', 
        ffmpeg: ffmpegMp3Args
    },
    wav: {
        contentType: 'audio/wav',
        audioType: 'music',
        ffmpeg: ffmpegWavArgs
    }
}

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

export const createFfmpegInstance = () => {
    const ffmpegOutputParams = AUDIO_CONFIG[outputType].ffmpeg;
    const child = spawn('ffmpeg', ffmpegOutputParams);
    const inputPassThrough = new PassThrough();
    inputPassThrough.pipe(child.stdin);
    const outputPassThrough = new PassThrough();
    child.stdout.pipe(outputPassThrough);

    child.stderr.on('data', data => {
        const output = data.toString();
        if (output.includes('size=')) {
        const timeMatch = output.match(/time=(\d{2}:\d{2}:\d{2})/);
            if (timeMatch) {
                console.log(`FFMPEG [PID ${child.pid}] (Audio). Recording in progress... Duration: ${timeMatch[1]}`);
            }
        }
    });
    child.on('error', (err) => {
        console.error(`FFMPEG [PID ${child.pid}] (Audio) process error:`, err);
    });

  return { child, input: inputPassThrough, output: outputPassThrough, pid: child.pid, active: false };
};

export const createSttFfmpegInstance = () => {
    const child = spawn('ffmpeg', ffmpegWavArgs);
    const inputPassThrough = new PassThrough();
    inputPassThrough.pipe(child.stdin);

    child.stderr.on('data', data => {
        const output = data.toString();
        if (output.includes('size=')) {
        const timeMatch = output.match(/time=(\d{2}:\d{2}:\d{2})/);
            if (timeMatch) {
                console.log(`FFMPEG [PID ${child.pid}] (STT). Recording in progress... Duration: ${timeMatch[1]}`);
            }
        }
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

export const initializeFFmpegPools = () => {
    refillFFmpegPool();
    refillSttPool();
};

const killFfmpegInstance = (wssId, activeSessions, delay = stopDelay) => {
    const activeSession = activeSessions.get(wssId);
    if(activeSession) {
        activeSession.active = false; // prevent writing to stream
        try {
            if (activeSession.input?.writable) {
                console.log(`FFMPEG [PID ${activeSession.pid}] input closed (EOF signal).`);
                activeSession.input.end();
            }
        } catch(e) {
            console.error(`Error cleaning up session ${wssId}: ${e}`);
        }
        
        // if (activeSession.output?.writable) { // if has audio stream
        //     console.log(`Ending audio stream for ${wssId} and scheduling removal in ${delay}ms...`)
        //     activeSession.output.end(); 
        // }
        // if (activeSession.child?.stdin) {
        //     console.log(`FFMPEG [PID ${activeSession.pid}] child input closed (EOF signal).`);
        //     activeSession.child.stdin.end();
        // }

        activeSession.child.kill('SIGKILL');
        console.log(`FFMPEG [PID ${activeSession.pid}] forcefully terminated.`);

        // Remove PID from the global tracking array
        const pidIndex = activeFfmpegPIDs.indexOf(activeSession.pid);
        if (pidIndex > -1) {
            activeFfmpegPIDs.splice(pidIndex, 1);
            console.log(`PID ${activeSession.pid} removed from active tracking. Remaining PIDs: ${activeFfmpegPIDs.length}`);
        }
        setTimeout(() => {
            const activeSession = activeSessions.get(wssId);
            if(activeSession) { // check again after delay
                console.log(`Removing session ${wssId}`);
                activeSessions.delete(wssId);
            }
            checkAndRefillPools();
        }, delay);
    }
};