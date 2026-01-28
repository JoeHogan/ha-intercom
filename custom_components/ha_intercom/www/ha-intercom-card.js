import { LitElement, html, css } from "https://unpkg.com/lit-element@4.1.1/lit-element.js?module";
import * as mediasoupClient from "https://esm.sh/mediasoup-client";
import { getAccessToken } from "./refreshToken.js";

class HaIntercomCard extends LitElement {

  setConfig(config) {
    if (!config.clientId) {
      let err = `You need to specify a 'clientId' for the intercom`;
      console.error(`HA-Intercom: ${err}`);
      this.invalidConfig = { clientId: err };
      return;
    }
    if (!config.room_prefix) {
      console.warn("Optional 'room_prefix' not defined in card config.");
    }
    this.getConfig(config.clientId)
      .then((storedConfig) => {
        this.config = config;
        this.CLIENT_ID = storedConfig.clientId;
        this.TARGETS = this.config.targets ? Array.isArray(this.config.targets) ? this.config.targets : [this.config.targets] : [];
        this.display = this.config.display && ['default', 'collapse', 'single'].indexOf(this.config.display.trim().toLowerCase()) > -1 ? this.config.display.trim().toLowerCase() : 'default';
        this.position = this.config.position && ['fixed', 'inline'].indexOf(this.config.position.trim().toLowerCase()) > -1 ? this.config.position.trim().toLowerCase() : 'fixed';
        this.open = this.display === 'collapse' ? false : true;
        this.connectSignaling();
      })
      .catch((e) => {
        console.error(`HA-Intercom: Error setting config: ${e}`);
        setTimeout(() => this.setConfig(config), 5000);
      })
  }

  set hass(hass) {
    this._hass = hass;
  }

  static get properties() {
    return {
      _hass: { state: true },
      config: { state: true },
      roomState: { state: true },
      localStream: { type: Object },
      invalidConfig: { type: Object },
      displaySetup: { type: Boolean },
      displayConfig: { type: Boolean },
      statusText: { type: String },
      latestTranscription: { type: String },
      open: { type: Boolean },
      fullscreen: { type: Boolean },
      outgoingMedia: { type: Object },
      incomingMedia: { type: Object },
      lastCaller: { type: Object },
      CLIENT_ID: { type: String },
      ENTITY_ID: { type: String },
      NAME: { type: String },
      CLIENTS: { type: Object },
      TARGETS: { type: Object },
      remoteStreams: { type: Object }
    };
  }

  static styles = css`
    :host {
      display: block;
      font-family: sans-serif;
      text-align: center;
      background-color: var(--card-background-color);
      color: var(--primary-text-color);
    }

    .btn {
      width: 50px;
      height: 50px;
      border-radius: 50%;
      border: 0;
      background-color: rgba(0, 100, 150, 0.7);
      color: white;
      margin: 0 auto;
      box-shadow: 0 0 10px rgba(0, 0, 255, 0.5);
    }

    .btn-normal {
      min-width: 100px;
      height: 30px;
      border-radius: 4px;
      border: 0;
      background-color: rgba(0, 100, 150, 0.8);
      color: white;
      margin: 0 auto;
      box-shadow: 0 0 10px rgba(0, 0, 255, 0.5);
    }

    button.link {
      color: var(--primary-text-color);
      border: 0;
      background: none;
      cursor: pointer;
    }

    .mic-indicator {
      display: block;
      animation: none;
      touch-action: none;
      user-select: none;
      -webkit-user-select: none;
    }

    .mic-indicator.starting {
      background-color: red;
      animation: blink 1s infinite;
      box-shadow: 0 0 10px rgba(255, 0, 0, 0.5);
    }

    .mic-indicator.ready {
      animation: none;
      background-color: green;
      box-shadow: 0 0 15px rgba(0, 255, 0, 0.8);
    }

    .name {
      font-weight: bold;
      margin-top: 10px;
    }

    .status {
      font-style: italic;
      margin-top: 0;
    }

    .latest-transcription {
      margin-top: 5px;
      padding: 20px;
      background-color: var(--card-background-color);
      color: var(--primary-text-color);
      border-radius: 4px;
      width: 30%;
      margin-left: auto;
      margin-right: auto;
    }

    #current-config {
      padding: 10px;
      .details {
        text-align: left;
        margin-bottom: 20px;
      }
      .actions {
        text-align: left;
      }
      .reset-config {
        background-color: rgba(255, 0, 0, 0.8);
        margin-left: 10px;
      }
    }

    #media-container {
      position: relative;
      overflow: visible;

      .toggle-menu {
        display: none;
        align-items: center;
        background-color: rgba(0, 0, 0, 0.1);
        border-radius: 35px;
        padding: 10px;
        > .details {
          flex-grow: 1;
        }
      }

      .message-container {

        position: absolute;
        height: 0;
        width: 0;
        background: white;
        z-index: 10;
        overflow: hidden;
        background-color: var(--card-background-color);
        color: var(--primary-text-color);

        &.open {
          position: relative;
          height: unset;
          width: 100%;
          margin: auto;
          z-index: 11;
          aspect-ratio: 16 / 9;

          &.fullscreen {

            position: fixed;
            height: 100%;
            width: 100%;
            bottom: 0;
            right: 0;
            z-index: 12;

            .av-container {
              position: relative;
              height: 100%;
              width: 100%;
              height: 100%;

              video {
                position: absolute;
                min-width: 100%;
                min-height: 100%;
                transform: translate(-50%, -50%);
                left: 50%;
                top: 50%;
                object-fit: cover;

                + video {
                  aspect-ratio: 16 / 9;
                  width: 25%;
                  min-width: unset;
                  min-height: unset;
                  top: unset;
                  transform: unset;
                  object-fit: unset;
                  bottom: 0;
                  z-index: 12;
                  left: 0;
                  border-right: 1px solid white;
                  border-top: 1px solid white;
                  border-top-right-radius: 6px;
                }
              }
            }

            .header, .footer {
              z-index: 11;
            }
          }
          .actions {
            z-index: 12;
          }
        }

        .actions {
          position: absolute;
          top: 5px;
          z-index: 11;

          &.left {
            left: 5px;
          }

          &.right {
            right: 5px;
          }

          button {
            display: block;
            margin-bottom: 10px;
            background-color: rgba(0, 0, 0, 0.25);
          }
        }

        .header {
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          background: rgba(0, 0, 0, 0.6);
          color: white;
          height: 20px;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .footer {
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          background: rgba(0, 0, 0, 0.6);
          color: white;
          height: 20px;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .call-ended-container {
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          height: 100%;
          text-align: center;
          padding: 20px;

          .header, .footer {
            position: static;
            background: none;
            color: inherit;
            height: auto;
          }

          .actions-center {
            display: flex;
            gap: 10px;
            margin-top: 10px;
          }
        }

        .av-container {
          width: 100%;
          height: 100%;
          overflow: hidden;

          video {
            width: 100%;

            + video {
                aspect-ratio: 16 / 9;
                width: 25%;
                position: absolute;
                object-fit: cover;
                bottom: 0;
                z-index: 12;
                left: 0;
                border-right: 1px solid white;
                border-top: 1px solid white;
                border-top-right-radius: 6px;
              }
          }
        }
        .img-container {
          + video {
            position: absolute;
            aspect-ratio: 16 / 9;
            width: 25%;
            min-width: unset;
            min-height: unset;
            top: unset;
            transform: unset;
            object-fit: cover;
            bottom: 0;
            z-index: 12;
            left: 0;
            border-right: 1px solid white;
            border-top: 1px solid white;
            border-top-right-radius: 6px;
          }
        }
      }

      &.fixed {
        .message-container {
          &.open {
            position: fixed;
            height: unset;
            width: 25%;
            min-width: 300px;
            bottom: 20px;
            right: 20px;
            aspect-ratio: 16 / 9;
          }
          &.fullscreen {
            position: fixed;
            height: 100%;
            width: 100%;
            bottom: 0;
            right: 0;
            z-index: 12;
          }
        }
      }

      &.collapse {

        .toggle-menu {
          display: flex;
        }

        &.open {
          z-index: 1;

          .toggle-menu {
            .btn {
              background-color: rgba(0, 0, 0, 0.5);
            }
          }

          .client-list {
            position: absolute;
            top: 0;'
            left: 0;
            right: 0;
            background-color: var(--card-background-color);
            color: var(--primary-text-color);
            margin-top: 70px;
            max-height: 300px;
            overflow: auto;
          }

        }

        &.closed {

          .client-list {
            position: absolute;
            height: 0;
            width: 0;
            overflow: hidden;
          }

        }

      }

      .client-list {
        .list-item {
          display: flex;
          align-items: center;
          padding: 10px;
          > div:first-child {
            flex-grow: 1;
            text-align: left;
          }
          > * + * {
            margin-left: 10px;
          }
          + .list-item {
            border-top: 1px solid #ccc;
          }
        }
      }

    }

    form {
      min-width: 200px;
      width: 50%;
      padding: 5px 10px;

      .actions {
        text-align: left;
      }
    }

    .form-control {
      text-align: left;
      width: 100%;
      margin-bottom: 20px;

      label {
        display: block;
      }

      input {
        padding: 6px;
        width: calc(100% - 16px);
        display: block;
      }

      .hint {
        margin-top: 5px;
        color: gray;
        font-size: 0.9em;
      }
    }

    .loading-container {
      width: 100%;
      height: 4px;
      background-color: #e0e0e0;
      position: relative;
      overflow: hidden;
      margin: 10px;

      .loading-bar {
        width: 50%;
        height: 100%;
        background-color: rgba(0, 100, 150, 1);
        position: absolute;
        left: -50%;
        animation: loading 1.5s infinite ease-in-out;
      }
    }

    .audio-unlock-btn {
      display: none;
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 60px;
      height: 60px;
      border-radius: 50%;
      background-color: #FF8C00;
      color: white;
      border: none;
      cursor: pointer;
      z-index: 3;
      box-shadow: 0 4px 15px rgba(0,0,0,0.3);
      font-weight: bold;
      align-items: center;
      justify-content: center;
      animation: pulse 2s infinite;
    }

    @keyframes loading {
      0% {
        transform: translateX(0);
      }
      100% {
        transform: translateX(300%); /* Moves it across the 100% width parent */
      }
    }

    @keyframes blink {
      0% { opacity: 1; }
      50% { opacity: 0.2; }
      100% { opacity: 1; }
    }

    @keyframes pulse {
      0% { transform: scale(1); }
      50% { transform: scale(1.1); }
      100% { transform: scale(1); }
    }
  `;

  constructor() {
    super();
    this.CLIENTS = [];
    this.TARGETS = [];
    this.NAME = '';
    this.ENTITY_ID = '';
    this.roomState = 'idle';
    this.roomId = null;
    this.localStream = null;
    this.socket = null;
    this.device = new mediasoupClient.Device();;
    this.invalidConfig = null;
    this.displaySetup = false;
    this.retryDelay = 2000;
    this.connectTimeout = 5000;
    this.pingInterval = 30000;
    this.isManuallyClosed = false;
    this.audioElement = document.createElement('audio');
    this.incomingVideoElement = document.createElement('video');
    this.incomingVideoElement.autoplay = true;
    this.incomingVideoElement.playsinline = true;
    this.incomingVideoElement.setAttribute('playsinline', '');
    this.outgoingVideoElement = document.createElement('video');
    this.outgoingVideoElement.autoplay = true;
    this.outgoingVideoElement.playsinline = true;
    this.outgoingVideoElement.setAttribute('playsinline', '');
    this.outgoingVideoElement.muted = true;
    this.micButton = document.createElement('button');
    this.micButton.classList.add('btn');
    this.micButton.classList.add('mic-indicator');
    let micIcon = document.createElement('ha-icon');
    micIcon.setAttribute('icon', 'mdi:microphone');
    this.micButton.appendChild(micIcon);
    this.unlockBtn = document.createElement('button');
    this.unlockBtn.classList.add('audio-unlock-btn');
    let unblockIcon = document.createElement('ha-icon');
    unblockIcon.setAttribute('icon', 'mdi:security');
    this.unlockBtn.appendChild(unblockIcon);
    this.unlockBtn.addEventListener('click', () => {
      console.log("User gesture received. Audio/Video unlocked.");
      this.unlockBtn.style.display = 'none';
    });
    this.remoteStreams = new Map();
    this.lastCaller = null;
    this.callEndedTimeout = null;
    this.callEndedDelay = 10000;
    this.callStartTime = null;
    this.callDurationStr = '';
    this.audioConfig = true;
    this.videoConfig = {
      aspectRatio: 16/9
    };
  }

  connectedCallback() {
    super.connectedCallback();
    this.activationInterval = setInterval(() => {
      if (this.checkActivation()) {
        clearInterval(this.activationInterval);
      }
    }, 1000);
  }

  async connectSignaling() {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const host = window.location.host;

    console.log('HA-Intercom: Attempting to connect...');
    let access_token = await getAccessToken();
    this.socket = new WebSocket(`${protocol}://${host}/api/ha_intercom/ws?id=${this.CLIENT_ID || 'test'}&token=${access_token}`);

    this.connectTimer = setTimeout(() => {
      console.warn('HA-Intercom: Connection timeout. Retrying...');
      this.socket.close();
    }, this.connectTimeout);

    this.socket.onopen = () => {
      clearTimeout(this.connectTimer);
      console.log('HA-Intercom: WebSocket connected');
      this.sendMessage({ ...this.config, type: 'register' });
      this.startPing();
    };

    this.socket.onerror = (err) => {
      console.error('HA-Intercom: WebSocket error:', err);
    };

    this.socket.onclose = () => {
      clearTimeout(this.connectTimer);
      this.stopPing();
      if (!this.isManuallyClosed) {
        console.warn('HA-Intercom: WebSocket closed. Retrying...');
        setTimeout(() => this.connectSignaling(), this.retryDelay);
      }
    };

    this.socket.onmessage = async (event) => {
      const msg = JSON.parse(event.data);
      switch (msg.type) {
        case 'setup':
          this.displaySetup = true;
          break;
        case 'updateConfig':
          let { name, entity_id } = msg;
          this.NAME = name;
          this.ENTITY_ID = entity_id;
          this.displaySetup = false;
          break;
        case 'clients':
          let { clients } = msg;
          this.CLIENTS = clients;
          break;
        case 'config':
          break;
        case 'transportCreated':
          this.handleTransportCreated(msg);
          break;
        case 'producerCreated':
          if (this._pendingProduceCallback) {
            this._pendingProduceCallback({ id: msg.producerId });
            this._pendingProduceCallback = null;
          }
          break;
        case 'incomingMedia':
          this.clearCallEndedScreen();
          this.incomingMedia = { from: msg.from, roomId: msg.roomId };
          this.startPreview(msg.roomId);
          break;
        case 'roomJoined':
          if (!this.device.loaded) {
            await this.device.load({ routerRtpCapabilities: msg.routerRtpCapabilities });
          }
          this.sendMessage({ type: 'createTransport', direction: 'send', roomId: msg.roomId });
          this.sendMessage({ type: 'createTransport', direction: 'recv', roomId: msg.roomId });
          break;
        case 'roomClosed':
          this.showCallEndedScreen();
          this.hangUp();
          break;
        case 'newProducer':
          if (!this.incomingMedia && this.roomState === 'in-call' && msg.from) {
            this.incomingMedia = { from: msg.from, roomId: this.roomId };
          }
          await this.consumeRemoteTrack(msg.producerId, msg.kind);
          break;

        case 'consumed':
          this.handleConsumed(msg.params);
          break;
      }
    };
  }

  closeSignaling() {
    this.isManuallyClosed = true;
    if (this.socket && this.socket.readyState !== WebSocket.CLOSED) {
      this.socket.close();
    }
  }

  startPing() {
    if (this.pingServer) {
      clearInterval(this.pingServer);
    }
    this.pingServer = setInterval(() => {
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.sendMessage({ type: 'ping' });
      } else {
        this.stopPing();
      }
    }, this.pingInterval);
  }

  stopPing() {
    if (this.pingServer) {
      clearInterval(this.pingServer);
      this.pingServer = null;
    }
  }

  async startClientCall(client, type = 'audio') {
    this.clearCallEndedScreen();
    let targets = [{ ...client, type }];
    return this.startCall(targets, type);
  }

  async startCall(targets, type = 'audio') {
    this.toggleMenu(false);
    const prefix = this.config?.room_prefix || 'ha-room';
    this.roomId = `${prefix}-${Math.random().toString(36).substring(7)}`;
    this.roomState = 'in-call';
    this.mediaType = type;
    this.callStartTime = Date.now();

    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: this.audioConfig, video: type === 'video' ? this.videoConfig : false });
      this.outgoingVideoElement.srcObject = this.localStream;
      this.outgoingMedia = { type, to: targets[0] };
    } catch (err) {
      console.warn(`Failed to get one or more media devices: ${err}`);
      try {
        this.localStream = await navigator.mediaDevices.getUserMedia({ audio: this.audioConfig });
      } catch (audioErr) {
        console.error(`No media devices available or permissions denied: ${audioErr}`);
        throw audioErr;
      }
    }

    this.sendMessage({
      type: 'create',
      roomId: this.roomId,
      targets
    });
  }

  async startPreview(roomId) {
    this.roomId = roomId;

    this.sendMessage({
      type: 'join',
      roomId
    });
  }

  async joinCall(roomId, type = 'audio') {
    // If already connected (previewing), just need to start producing.
    let isUpgrade = false;
    if (this.roomId === roomId && this.device && this.device.loaded) {
      isUpgrade = true;
    }
    this.mediaType = type;
    this.roomId = roomId;
    this.roomState = 'in-call';
    this.callStartTime = Date.now();
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({ audio: this.audioConfig, video: type === 'video' ? this.videoConfig : false });
      this.outgoingVideoElement.srcObject = this.localStream;
      this.outgoingMedia = { type, to: this.incomingMedia?.from };
    } catch (err) {
      console.warn(`Failed to get one or more media devices: ${err}`);
      try {
        // fallback to just Audio
        this.localStream = await navigator.mediaDevices.getUserMedia({ audio: this.audioConfig });
        this.outgoingMedia = { type: 'audio', to: this.incomingMedia?.from };
      } catch (audioErr) {
        console.error(`No media devices available or permissions denied: ${audioErr}`);
        throw audioErr;
      }
    }

    if (!isUpgrade) {
      this.sendMessage({
        type: 'join',
        roomId,
        mediaType: type
      });
    } else {
      // if already joined, just start producing

      await this.produceMedia();

    }
  }

  async handleConsumed(params) {
    const { id, producerId, kind, rtpParameters } = params;

    // create the local consumer on receiving transport
    const consumer = await this.receiveTransport.consume({
      id,
      producerId,
      kind,
      rtpParameters
    });

    // tell the server to RESUME the consumer (mediasoup starts them paused)
    this.socket.send(JSON.stringify({
      type: 'resumeConsumer',
      roomId: this.roomId,
      consumerId: consumer.id
    }));

    const callType = this.incomingMedia?.from?.type || 'audio';

    if (callType === 'audio') {
      if (kind === 'audio') {
        const stream = new MediaStream([consumer.track]);
        this.audioElement.srcObject = stream;
      }
      // If it's a video track but call type is audio, we ignore it
    } else if (callType === 'video') {
      // For video calls, we want both Audio and Video to play in the video element
      let stream = this.incomingVideoElement.srcObject;
      if (!stream || !(stream instanceof MediaStream) || stream.getTracks().length > 10) {
        // Create a new stream if none exists or it looks cluttered/stale
        stream = new MediaStream();
        this.incomingVideoElement.srcObject = stream;
      }
      stream.addTrack(consumer.track);
    }
    if(!this.outgoingMedia && !this.fullscreen && this.config.autoFullscreen) {
      this.toggleFullscreen(true);
    }
    this.requestUpdate();
  }

  showCallEndedScreen() {
    // Capture the last participant
    if (this.incomingMedia?.from) {
      this.lastCaller = this.incomingMedia.from;
    } else if (this.outgoingMedia?.to) {
      this.lastCaller = this.outgoingMedia.to;
    }

    if (this.lastCaller) {
      if (this.callStartTime) {
        const seconds = Math.round((Date.now() - this.callStartTime) / 1000);
        this.callDurationStr = this.formatDuration(seconds);
      } else {
        this.callDurationStr = '';
      }

      if (this.callEndedTimeout) clearTimeout(this.callEndedTimeout);
      this.callEndedTimeout = setTimeout(() => {
        this.clearCallEndedScreen();
      }, this.callEndedDelay);
      this.requestUpdate();
    }
  }

  clearCallEndedScreen() {
    if (this.callEndedTimeout) {
      clearTimeout(this.callEndedTimeout);
      this.callEndedTimeout = null;
    }
    this.lastCaller = null;
    this.callStartTime = null;
    this.callDurationStr = '';
    this.requestUpdate();
  }

  formatDuration(seconds) {
    if (seconds < 60) return `${seconds}s`;
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) {
      return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
    return `${m}:${s.toString().padStart(2, '0')}`;
  }

  hangUp() {
    if (this.roomId) {
      this.sendMessage({ type: 'hangup', roomId: this.roomId });
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach(t => t.stop());
    }

    // Close transports
    if (this.sendTransport) {
      this.sendTransport.close();
      this.sendTransport = null;
    }
    if (this.receiveTransport) {
      this.receiveTransport.close();
      this.receiveTransport = null;
    }

    // Clear media elements
    if (this.incomingVideoElement) {
      this.incomingVideoElement.srcObject = null;
      this.incomingVideoElement.load();
    }
    if (this.outgoingVideoElement) {
      this.outgoingVideoElement.srcObject = null;
      this.outgoingVideoElement.load();
    }
    if (this.audioElement) {
      this.audioElement.srcObject = null;
      this.audioElement.load();
    }

    this.roomState = 'idle';
    this.roomId = null;
    this.mediaType = null;
    this.localStream = null;
    this.incomingMedia = null;
    this.outgoingMedia = null;
    this.remoteStreams.clear();
    this.toggleFullscreen(false);
  }

  sendMessage(msg) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg));
    }
  }

  async getConfig(clientId) {
    const key = 'ha-intercom';
    let config = localStorage.getItem(key);
    if (config) {
      try {
        config = JSON.parse(config);
        if (config[clientId]) {
          return Promise.resolve(config[clientId]);
        } else {
          throw new Error("Stored Config does not contain the ClientId");
        }
      } catch (e) {
        console.error(`HA-Intercom: ${e}`);
      }
    }
    return import('https://cdn.jsdelivr.net/npm/@thumbmarkjs/thumbmarkjs/dist/thumbmark.umd.js')
      .then(() => {
        return new ThumbmarkJS.Thumbmark().get();
      })
      .then(({ thumbmark }) => {
        config = { ...(config || {}), [clientId]: { thumbmark, clientId: `${thumbmark}_${clientId}` } };
        localStorage.setItem(key, JSON.stringify(config));
        return config[clientId];
      })
      .catch((e) => {
        console.error('HA-Intercom: Error getting clientId');
        return null;
      });
  }

  // Create the Mediasoup Transport
  async handleTransportCreated(msg) {
    const { roomId, params, direction } = msg;

    if (direction === 'send') {
      this.sendTransport = this.device.createSendTransport(params);

      this.sendTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
        this.sendMessage({
          type: 'connectTransport',
          roomId,
          transportId: this.sendTransport.id,
          dtlsParameters
        });
        callback();
      });

      this.sendTransport.on('produce', async ({ kind, rtpParameters }, callback, errback) => {
        this.sendMessage({
          type: 'produce',
          mediaType: this.mediaType,
          roomId,
          transportId: this.sendTransport.id,
          kind,
          rtpParameters
        });
        this._pendingProduceCallback = callback;
      });

      await this.produceMedia();

    } else {
      this.receiveTransport = this.device.createRecvTransport(params);

      this.receiveTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
        this.sendMessage({
          type: 'connectTransport',
          roomId,
          transportId: this.receiveTransport.id,
          dtlsParameters
        });
        callback();
      });
    }
  }

  // Start Producing Media
  async produceMedia() {
    if (!this.sendTransport || !this.localStream) return;

    // Get all tracks (typically one audio, one video)
    const tracks = this.localStream.getTracks();

    for (const track of tracks) {
      try {
        console.log(`Producing ${track.kind} track...`);

        const producer = await this.sendTransport.produce({
          track: track,
          appData: { mediaTag: track.kind }
        });

        console.log(`${track.kind} producer created with ID: ${producer.id}`);
      } catch (err) {
        console.error(`Error producing ${track.kind}:`, err);
      }
    }
  }

  async consumeRemoteTrack(producerId, kind) {
    if (!this.receiveTransport) {
      console.warn("Receive transport not ready yet");
      setTimeout(() => this.consumeRemoteTrack(producerId, kind), 500);
      return;
    }

    const { rtpCapabilities } = this.device;

    this.sendMessage({
      type: 'consume',
      roomId: this.roomId,
      transportId: this.receiveTransport.id,
      producerId,
      rtpCapabilities
    });
  }


  updateConfig(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    const allData = Object.fromEntries(formData.entries());
    let entity_id = `ha_intercom.${allData.entity_id}`;
    this.socket?.send(this.sendMessage({ type: 'updateConfig', ...allData, entity_id }));
  }

  toggleConfig(open = undefined) {
    if (open !== undefined) {
      this.displayConfig = open ? true : false;
    } else {
      this.displayConfig = !this.displayConfig;
    }
    return this.displayConfig;
  }

  resetConfig() {
    this.socket.send(JSON.stringify({ type: 'reset', clientId: this.CLIENT_ID }));
    this.displaySetup = true;
    this.toggleConfig(false);
  }

  toggleMenu(state = undefined) {
    if (state !== undefined) {
      this.open = state;
    } else {
      this.open = !this.open;
    }
    return this.open;
  }

  toggleFullscreen(open = undefined) {
    if (open !== undefined) {
      this.fullscreen = open ? true : false;
    } else {
      this.fullscreen = !this.fullscreen;
    }
    return this.fullscreen;
  }

  closeMediaWindow() {
    this.clearCallEndedScreen();
    this.hangUp();
  }

  render() {
    if (!this.config || !this._hass) return html``;

    if (this.invalidConfig) {
      return html`
        <div class="config-errors">
        ${Object.keys(this.invalidConfig).map(key => {
        return html`
            <div class="config-error">${this.invalidConfig[key]}</div>
          `
      })}
        </div>
      `;
    }
    if (this.displaySetup) {
      return html`
        <form @submit=${this.updateConfig}>
          <h3>HA-Intercom Client Configuration</h3>
          <div class="form-control">
            <label for="name">Client Name</label>
            <input id="name" type="text" name="name" required placeholder="Enter your client name..." />
            <div class="hint">Example: 'Bob's Phone'</div>
          </div>
          <div class="form-control">
            <label for="entity_id">Entity ID</label>
            <input id="entity_id" type="text" name="entity_id" required placeholder="Enter your Entity ID..." />
            <div class="hint">Each instance of HA-Intercom on each device should have a unique Entity ID</div>
            <div class="hint">Example: 'Bobs_Phone_Client_1'</div>
          </div>
          <div class="actions">
            <button class="btn-normal update-config" type="submit">
                Update Config
            </button>
          </div>
        </div>
      `;
    }
    if (this.displayConfig) {
      return html`
        <div id="current-config">
          <div class="details">
            <div>Name: ${this.NAME}</div>
            <div>Entity ID: ${this.ENTITY_ID}</div>
          </div>
          <div class="actions">
            <button class="btn-normal cancel" @click="${() => this.toggleConfig(false)}">
                Cancel
            </button>
            <button class="btn-normal reset-config" @click="${() => this.resetConfig()}">
                Reset Config
            </button>
          </div>
        </div>
      `;
    }
    if (!this.CLIENT_ID || !this.ENTITY_ID) {
      return html`
        <div class="loading-container">
          <div class="loading-bar"></div>
        </div>
      `;
    }
    if (this.display === 'single') {
      return html`
        ${this.micButton}
      `;
    }
    return html`
      <div id="media-container" class="${this.display} ${this.position} ${this.open ? 'open' : 'closed'}">
        <div class="toggle-menu">
          <button type="button" class="link" @click="${() => this.toggleConfig(true)}">
            ${this.NAME}
          </button>
          <div class="details">${this.CLIENTS.length + this.TARGETS.length} Intercom Clients</div>
          <button type="button" class="btn" @click="${() => this.toggleMenu()}">
            ${this.open ? html`<ha-icon icon="mdi:close"></ha-icon>` : html`<ha-icon icon="mdi:message"></ha-icon>`}
          </button>
        </div>
        <div class="client-list">
          ${this.CLIENTS.map(client => {
      return html`
              <div class="list-item client">
                <div>${client.name || client.clientId || 'unknown'}</div>
                ${client.video ? html`<button type="button" class="btn video" @click="${this.startClientCall.bind(this, client, 'video')}">
                  <ha-icon icon="mdi:video"></ha-icon>
                </button>` : null}
                <button type="button" class="btn audio" @click="${this.startClientCall.bind(this, client, 'audio')}">
                  <ha-icon icon="mdi:microphone"></ha-icon>
                </button>
              </div>
            `
    })}
          ${this.TARGETS.map(target => {
      return html`
              <div class="list-item target">
                <div>${target.name || 'unknown'}</div>
                ${target.video ? html`<button type="button" class="btn video" @click="${this.startCall.bind(this, target.entities, 'video')}">
                  <ha-icon icon="mdi:video"></ha-icon>
                </button>` : null}
                <button type="button" class="btn audio" @click="${this.startCall.bind(this, target.entities, 'audio')}">
                  <ha-icon icon="mdi:microphone"></ha-icon>
                </button>
              </div>
            `
    })}
        </div>
        <div style="display: none" class="send-message-container ${this.incomingMedia ? 'inactive' : 'active'}">
          ${this.config.name
        ? html`<div class="name">${this.config.name}</div>`
        : null
      }
          ${!this.config.hideStatus
        ? html`<div class="status">${this.statusText}</div>`
        : null
      }
          ${!this.config.hideTranscription
        ? html`<div class="latest-transcription">${this.latestTranscription}</div>`
        : null
      }
        </div>
          <div class="message-container ${this.incomingMedia || this.outgoingMedia || this.lastCaller ? 'open' : 'closed'} ${this.fullscreen ? 'fullscreen' : ''}">

            <div class="actions left">
              <button class="btn fullscreen" @click="${() => this.toggleFullscreen()}">
                ${this.fullscreen ? html`<ha-icon icon="mdi:fullscreen-exit"></ha-icon>` : html`<ha-icon icon="mdi:fullscreen"></ha-icon>`}
              </button>
            </div>
            <div class="actions right">
              <button class="btn close-response" @click="${() => { this.closeMediaWindow() }}">
                <ha-icon icon="mdi:close"></ha-icon>
              </button>
              ${this.incomingMedia && !this.outgoingMedia
        ? html`
                  <button type="button" class="btn audio" @click="${this.joinCall.bind(this, this.incomingMedia.roomId, 'video')}">
                      <ha-icon icon="mdi:video"></ha-icon>
                    </button>
                    <button type="button" class="btn audio" @click="${this.joinCall.bind(this, this.incomingMedia.roomId, 'audio')}">
                      <ha-icon icon="mdi:microphone"></ha-icon>
                    </button>
                `
        : null
      }
            </div>

            ${this.lastCaller && !this.incomingMedia && !this.outgoingMedia ? html`
              <div class="call-ended-container">
                <div class="header">Call Ended with <strong>${this.lastCaller.name || this.lastCaller.entity_id || 'unknown'}</strong></div>
                ${this.callDurationStr ? html`<div class="duration">Call Duration: ${this.callDurationStr}</div>` : null}
                <div class="footer">Would you like to call back?</div>
                <div class="actions-center">
                  <button type="button" class="btn audio" @click="${() => { this.startClientCall(this.lastCaller, 'audio') }}">
                    <ha-icon icon="mdi:microphone"></ha-icon>
                  </button>
                  <button type="button" class="btn video" @click="${() => { this.startClientCall(this.lastCaller, 'video') }}">
                    <ha-icon icon="mdi:video"></ha-icon>
                  </button>
                </div>
              </div>
            ` : html`
              <div class="header">Message ${this.incomingMedia ? 'From' : 'To'}: <strong>${this.incomingMedia ? (this.incomingMedia?.from?.name || this.incomingMedia?.from?.entity_id || 'unknown') : (this.outgoingMedia?.to?.name || this.outgoingMedia?.to?.entity_id || 'unknown')}</strong></div>

              <div class="av-container ${this.incomingMedia?.from?.type || ''}">
                ${this.incomingMedia?.from?.type === 'audio' ? this.audioElement : null}
                ${this.incomingMedia?.from?.type === 'audio' || (!this.incomingMedia && this.outgoingMedia?.type === 'audio')
          ? html`
                      <div class="img-container">
                        <img src="/ha_intercom/sound.gif" alt="Incoming audio">
                      </div>
                  `
          : null
        }
                ${this.incomingMedia?.from?.type === 'video' ? this.incomingVideoElement : null}
                ${this.outgoingMedia?.type === 'video' ? this.outgoingVideoElement : null}
              </div>

              ${this.incomingMedia && !this.outgoingMedia
          ? html`
                  <div class="footer">
                    <div>Select an action to respond</div>
                  </div>
                `
          : null
        }
            `}
          </div>
      </div>
      ${this.config.hideUnlockButton ? null : this.unlockBtn}
    `;
  }

  getCardSize() {
    return 4;
  }

  checkActivation() {
    if (navigator.userActivation && navigator.userActivation.hasBeenActive) {
      this.unlockBtn.style.display = 'none';
      return true;
    } else {
      this.unlockBtn.style.display = 'flex';
      return false;
    }
  }

}

customElements.define('ha-intercom-card', HaIntercomCard);