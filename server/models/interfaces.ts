import * as mediasoup from 'mediasoup';
import { WebSocket } from 'ws';
import { PassThrough } from 'stream';
import { ChildProcess } from 'child_process';

interface Client {
    ws: WebSocket;
    transports?: Map<string, mediasoup.types.Transport>;
    producers?: Map<string, mediasoup.types.Producer>;
    consumers?: Map<string, mediasoup.types.Consumer>;
    isInitiator: boolean;
    mediaType?: 'audio' | 'video'
}

type EntityType = 'audio' | 'alexa';

export interface Entity {
    entity_id: string;
    type: EntityType;
    voice?: string;
    data?: {
        type?: 'announce'
    }
}

interface FfmpegInstance {
    child: ChildProcess;
    input: PassThrough;
    output: PassThrough;
    pid: number;
    active: boolean;
}

export interface RoomState {
    id: string;
    router: mediasoup.types.Router;
    hostProducerId: string | null;
    ffmpeg: {
        audio: FfmpegInstance | null;
        stt: FfmpegInstance | null;
    };
    clients: Map<string, Client>;
    targets: Entity[];
    entities: {
        video: Entity[];
        audio: Entity[];
        stt: Entity[];
        alexa: Entity[];
    };
    environment: {
        haUrl: string;
        audioHost: string;
        haToken: string;
    };
}