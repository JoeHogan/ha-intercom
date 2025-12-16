import { LitElement, html, css } from "https://unpkg.com/lit-element@4.1.1/lit-element.js?module";
import { getAccessToken } from "./refreshToken.js";

export class HaIntercomCard extends LitElement {
  static styles = css`
    :host {
      display: block;
      font-family: sans-serif;
      text-align: center;
      color: black;
      background-color: white;
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

    #media-container {
      position: relative;
      overflow: visible;
    }

    .send-message-container {
    }

    .send-message-container.inactive {
    }

    #incoming-message-container {
      visibility: hidden;
      position: absolute;
      background: white;
      z-index: 1;
      overflow: hidden;
      background-color: black;
      color: white;
      .actions {
        position: absolute;
        top: 25px;
        right: 5px;
        z-index: 1;
        button {
          margin-bottom: 10px;
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
      }

      video {
        width: 100%;
      }
    }

    #incoming-message-container.inline {
      top: 0;
      left: 0;
      min-width: 100%;
      min-height: 100%;
    }

    #incoming-message-container.fixed {
        position: fixed;
        width: 25%;
        min-width: 300px;
        bottom: 10px;
        right: 10px;
    }

    #incoming-message-container.active {
      visibility: visible;
    }

    #incoming-message-container #av-container {
      width: 100%;
      aspect-ratio: 16 / 9;
      overflow: hidden;
    }

    .img-container {
      position: absolute;
      top: 40px;
      left: 0;
      right: 0;
      > img {
        width: 30%;
      }
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
      background-color: #ccc;
      border-radius: 4px;
      width: 30%;
      margin-left: auto;
      margin-right: auto;
    }

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

    @keyframes blink {
      0% { opacity: 1; }
      50% { opacity: 0.2; }
      100% { opacity: 1; }
    }
  `;

  static get properties() {
    return {
      hass: {},
      config: {},
      statusText: { type: String },
      latestTranscription: { type: String },
      activeMediaElement: { type: Object },
      invalidConfig: { type: Object },
      displaySetup: { type: Boolean },
      listening: { type: Boolean },
      CLIENT_ID: { type: String },
      ENTITY_ID: { type: String },
      NAME: { type: String },
      CLIENTS: { type: Object },
      TARGETS: { type: Object }
    };
  }

  constructor() {
    super();
    this.isMouseDown = false;
    this.isTouchDown = false;
    this.statusText = 'Microphone not active';
    this.latestTranscription = '';
    this.activeMediaElement = null;
    this.invalidConfig = null;
    this.displaySetup = false;
    this.CLIENTS = [];
    this.TARGETS = [];
    this.ws = null;
    this.retryDelay = 2000;
    this.connectTimeout = 5000;
    this.isManuallyClosed = false;
    this.listening = false;
    this.indicatorTimeout = null;
    this.getDevices = null;
    this.pingInterval = null;
    this.pingInterval = 30000;
    this.releaseTimeout = null;
    this.stopDelayTimeout = null;
    this.debounceTime = 500;
    this.recordInterval = 250;
    this.stopDelay = 250;
    this.hideActiveElementDelay = 5000;
    this.audioElement = document.createElement('audio');
    this.videoElement = document.createElement('video');
    this.videoElement.autoplay = true;
    this.videoElement.playsinline = true;
    this.videoElement.setAttribute('playsinline', '');
    this.micButton = document.createElement('button');
    this.micButton.classList.add('btn');
    this.micButton.classList.add('mic-indicator');
    let micIcon = document.createElement('ha-icon');
    micIcon.setAttribute('icon', 'mdi:microphone');
    this.micButton.appendChild(micIcon);
    this.micButtonReply = this.micButton.cloneNode(true);
  }

  render() {
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
          <div>
            <label for="name">Client Name</label>
            <input id="name" type="text" name="name" required placeholder="Enter your client name..." />
          </div>
          <div>
            <label for="entity_id">Entity ID</label>
            <input id="entity_id" type="text" name="entity_id" required placeholder="Enter your Entity ID..." />
          </div>
          <button class="update-config" type="submit">
              Update Config
          </button>
        </div>
      `;
    }
    if (this.listening) {
      return html`
        <div class="listening">
          ${this.micButton}
        </div>
      `;
    }
    return this.CLIENT_ID && this.ENTITY_ID ? html`
      <div id="media-container">
        ${this.CLIENTS.map(client => {
          return html`
            <div class="list-item client">
              <div>${client.name || client.clientId || 'unknown'}</div>
              ${client.video ? html`<button type="button" class="btn video" @click="${this.startListeningClient.bind(this, client, 'video')}">
                <ha-icon icon="mdi:video"></ha-icon>
              </button>` : null}
              <button type="button" class="btn audio" @click="${this.startListeningClient.bind(this, client, 'audio')}">
                <ha-icon icon="mdi:microphone"></ha-icon>
              </button>
              <button type="button" class="btn call" @click="${this.startListeningClient.bind(this, client, 'call')}">
                <ha-icon icon="mdi:phone"></ha-icon>
              </button>
            </div>
          `
        })}
        ${this.TARGETS.map(target => {
          return html`
            <div class="list-item target">
              <div>${target.name || 'unknown'}</div>
              ${target.video ? html`<button type="button" class="btn video" @click="${this.startListening.bind(this, target)}">
                <ha-icon icon="mdi:video"></ha-icon>
              </button>` : null}
              <button type="button" class="btn audio" @click="${this.startListening.bind(this, target)}">
                <ha-icon icon="mdi:microphone"></ha-icon>
              </button>
            </div>
          `
        })}
        <div style="display: none" class="send-message-container ${this.activeMediaElement ? 'inactive' : 'active'}">
          ${this.micButton}
          ${this.config.name
            ? html`<div class="name">${this.config.name}</div>`
            : html``
          }
          ${!this.config.hideStatus
            ? html`<div class="status">${this.statusText}</div>`
            : html``
          }
          ${!this.config.hideTranscription
            ? html`<div class="latest-transcription">${this.latestTranscription}</div>`
            : html``
          }
        </div>
        <div id="incoming-message-container" class="fixed ${this.activeMediaElement ? 'active' : 'inactive'}">
          <div class="actions">
            <button class="btn close-response" @click="${this.closeReplyWindow}">
              <ha-icon icon="mdi:close"></ha-icon>
            </button>
            ${this.micButtonReply}
          </div>
          <div class="header">Message From: <strong>${this.activeMediaElement?.from?.name || this.activeMediaElement?.from?.entity_id || 'unknown'}</strong></div>
          ${this.activeMediaElement?.type === 'audio'
            ? html`
                <div class="img-container">
                  <img src="/ha_intercom/sound.gif" alt="Incoming audio">
                </div>
            `
            : html``
          }
          <div id="av-container" class="${this.activeMediaElement?.type || ''}">
            ${this.activeMediaElement?.type === 'audio' ? this.audioElement : null}
            ${this.activeMediaElement?.type === 'video' ? this.videoElement : null}
          </div>
        </div>
      </div>
    `
    : html`<div>Loading...</div>`;
  }

  setConfig(config) {
    if (!config.clientId) {
      let err = `You need to specify a 'clientId' for the intercom`;
      console.error(`HA-Intercom: ${err}`);
      this.invalidConfig = { clientId: err };
      return;
    }
    this.getConfig(config.clientId)
      .then((storedConfig) => {
        this.config = config;
        this.CLIENT_ID = storedConfig.clientId;
        this.TARGETS = this.config.targets ? Array.isArray(this.config.targets) ? this.config.targets : [this.config.targets] : [];
        this.connectWebSocket();
      })
      .catch((e) => {
        console.error(`HA-Intercom: Error setting config: ${e}`);
        setTimeout(() => this.setConfig(config), 5000);
      })
    }

  firstUpdated() {
    if (!window.MediaRecorder) {
      alert('MediaRecorder is not supported on this device.');
      return;
    }

    this.bindButtonEvents(this.micButton);
    this.bindButtonEvents(this.micButtonReply);
    this.resetVisuals(); // Initial state is reset
    this.setupAudioPlayback();
    this.setupVideoPlayback();
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
        config = { ...(config || {}), [clientId]: { thumbmark, clientId: `${thumbmark}_${clientId}` }};
        localStorage.setItem(key, JSON.stringify(config));
        return config[clientId];
      })
      .catch((e) => {
        console.error('HA-Intercom: Error getting clientId');
        return null;
      });
  }

  updateConfig(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    const allData = Object.fromEntries(formData.entries());
    this.ws?.send(this.createMessage({ type: 'config', ...allData }));
  }

  bindButtonEvents(btn) {

    // all events
    btn.addEventListener('click', this.checkCancelable.bind(this), { passive: false });

    // touch events
    btn.addEventListener('touchstart', this.toggleListening.bind(this), { passive: false });
    // btn.addEventListener('touchend', this.handleButtonRelease.bind(this), { passive: false });
    // btn.addEventListener('touchcancel', this.handleButtonRelease.bind(this), { passive: false });

    // mouse events
    btn.addEventListener('mousedown', this.toggleListening.bind(this), { passive: false });
    // btn.addEventListener('mouseup', this.handleButtonRelease.bind(this), { passive: false });
    // btn.addEventListener('mouseleave', this.handleButtonRelease.bind(this), { passive: false });

  }

  // Resets the visual indicator and status text to the default state
  resetVisuals() {
    let btn = this.activeMediaElement ? this.micButtonReply : this.micButton;
    if (this.indicatorTimeout) clearTimeout(this.indicatorTimeout);
    btn.classList.remove('starting', 'ready');
    btn.classList.remove('starting', 'ready');
    this.statusText = 'Microphone not active';
  }

  closeReplyWindow() {
    if (this.hideMediaElementTimeout) {
      clearTimeout(this.hideMediaElementTimeout);
    }
    this.activeMediaElement = null;
  }

  toggleListening(e) {
    if (this.listening) {
      this.handleStopListening(e);
    } else {
      this.startListening(e);
    }
  }

  startListeningClient({ name, entity_id }, type) {
    this.startListening({ name, entities: [{ entity_id: `ha_client.${entity_id}`, type }] }, type);
  }

  startListening(target, mediaType = 'audio') {
    if (this.listening) return;

    this.listening = true;
    target = this.activeMediaElement?.from?.id ? {name: this.activeMediaElement.from.name, entites: [{ entity_id: `ha_client.${this.activeMediaElement.from.id}` }] } : target;
    this.ws?.send(this.createMessage({ target, type: 'start' }));
    this.setIndicator(); // Set visual indicator to starting/ready

    this.getDevices = navigator.mediaDevices.getUserMedia({
        audio: {
          latency: { ideal: 0.01 }, // Explicitly request ultra-low latency (e.g., 10ms ideal)
          channelCount: 1,
          noiseSuppression: true,
          autoGainControl: true,
          echoCancellation: true
        },
        video: mediaType === 'video' ? {
            facingMode: "user", // or "environment" for back camera on mobile
            frameRate: { ideal: 60, max: 60 },
            width: { ideal: 640 },
            height: { ideal: 360 }
        } : false
      })
      .then(stream => {
        this.setIndicator(true);
        return new MediaRecorder(stream, { mimeType: (mediaType === 'video' ? 'video/webm;codecs=vp8,opus' : 'audio/webm;codecs=opus') })
      })
      .then(recorder => {
        if (recorder?.state === 'inactive') {
          recorder.ondataavailable = e => {
            if (e.data.size > 0) {
              e.data.arrayBuffer().then(buffer => {
                this.ws?.send(this.createMessage({ type: mediaType === 'video' ? 'video' : 'audio' }, buffer));
              });
            }
          };
          recorder.onstop = () => {
            // 2. Send the 'stop' command to the backend
            this.ws?.send(this.createMessage({ type: 'stop' }));
          };
          recorder.start(this.recordInterval);
        }
        return recorder;
      })
      .catch(err => {
        console.error('HA-Intercom: Recording error:', err);
        this.handleStopListening({}); // Call release handler to clean up state
      });
  }

//   startListening(e) {
//     this.checkCancelable(e);

//     // Reliable Events: Block redundant events and track state
//     if (e.type === 'touchstart') {
//       this.isTouchDown = true;
//       this.isMouseDown = false;
//     } else if (e.type === 'mousedown') {
//       if (this.isTouchDown) return;
//       this.isMouseDown = true;
//     }

//     // Debounce: Clear any pending release timeout
//     if (this.releaseTimeout) {
//       clearTimeout(this.releaseTimeout);
//       this.releaseTimeout = null;
//       if (this.listening) return; // Debounce successful, continue recording
//     }

//     // Clear stop delay timeout if it was scheduled but a new click started
//     if (this.stopDelayTimeout) {
//       clearTimeout(this.stopDelayTimeout);
//       this.stopDelayTimeout = null;
//     }

//     if (this.listening) return;

//     this.listening = true;
//     let target = this.activeMediaElement?.from?.id ? [{ entity_id: `ha_client.${this.activeMediaElement.from.id}` }] : null;
//     this.ws?.send(this.createMessage({ type: 'start', target }));
//     this.setIndicator(); // Set visual indicator to starting/ready

//     this.getDevices = navigator.mediaDevices.getUserMedia({
//         audio: {
//           latency: { ideal: 0.01 }, // Explicitly request ultra-low latency (e.g., 10ms ideal)
//           channelCount: 1,
//           noiseSuppression: true,
//           autoGainControl: true,
//           echoCancellation: true
//         },
//         video: this.config.video ? {
//             facingMode: "user", // or "environment" for back camera on mobile
//             frameRate: { ideal: 60, max: 60 },
//             width: { ideal: 640 },
//             height: { ideal: 360 }
//         } : false
//       })
//       .then(stream => {
//         this.setIndicator(true);
//         return new MediaRecorder(stream, { mimeType: (this.config.video ? 'video/webm;codecs=vp8,opus' : 'audio/webm;codecs=opus') })
//       })
//       .then(recorder => {
//         if (recorder?.state === 'inactive') {
//           recorder.ondataavailable = e => {
//             if (e.data.size > 0) {
//               e.data.arrayBuffer().then(buffer => {
//                 this.ws?.send(this.createMessage({ type: this.config.video ? 'video' : 'audio' }, buffer));
//               });
//             }
//           };
//           recorder.onstop = () => {
//             // 2. Send the 'stop' command to the backend
//             this.ws?.send(this.createMessage({ type: 'stop' }));
//           };
//           recorder.start(this.recordInterval);
//         }
//         return recorder;
//       })
//       .catch(err => {
//         console.error('HA-Intercom: Recording error:', err);
//         this.handleButtonRelease({}); // Call release handler to clean up state
//       });
// }

// Handles the first stage of release (debounce)

handleStopListening(target) {
  if (!this.listening) return;
  this.scheduleStopListening();
}

// handleButtonRelease(e) {
//     if (!this.listening) return;
//     this.checkCancelable(e);

//     // Reliable Events: Block redundant release events
//     if (e.type === 'touchend' || e.type === 'touchcancel') {
//         if (!this.isTouchDown) return;
//         this.isTouchDown = false;
//     } else if (e.type === 'mouseup' || e.type === 'mouseleave') {
//         if (!this.isMouseDown) return;
//         if (this.isTouchDown) return;
//         this.isMouseDown = false;
//     }

//     // If both flags are clear, but we are still listening, schedule the stop process
//     if (!this.isMouseDown && !this.isTouchDown && this.listening) {

//         // Clear any existing release timeout to prevent double scheduling
//         if (this.releaseTimeout) {
//             clearTimeout(this.releaseTimeout);
//         }

//         // Debounce: Start the release timer (500ms)
//         this.releaseTimeout = setTimeout(() => {
//             this.releaseTimeout = null;

//             // Debounce period expired: reset visuals and schedule stop command
//             this.scheduleStopListening();
//         }, this.debounceTime);
//     }
// }

// Schedules the final 'stop' after the 500ms debounce

scheduleStopListening() {
    // VISUAL DEBOUNCE: Reset the button appearance now that the 500ms debounce has passed
    this.resetVisuals();

    // Prevent double scheduling the final stop
    if (this.stopDelayTimeout) {
        clearTimeout(this.stopDelayTimeout);
    }

    // Delayed Stop: Schedule the actual stop with a delay
    this.stopDelayTimeout = setTimeout(() => {
        this.stopListening();
        this.stopDelayTimeout = null;
    }, this.stopDelay);
  }

showMediaElement(type, clientInfo) { // type = video or audio

  this.activeMediaElement = {
    type,
    from: clientInfo.from
  };

  if (this.hideMediaElementTimeout) {
      clearTimeout(this.hideMediaElementTimeout);
  }

  // Delayed Stop: Schedule the actual stop with a delay
  this.hideMediaElementTimeout = setTimeout(() => {
    if (this.listening) { // assume user is replying...
      this.showMediaElement(type, clientInfo);
    } else {
      this.activeMediaElement = null;
      this.hideMediaElementTimeout = null;
    }
  }, this.hideActiveElementDelay);
}

// The final cleanup and 'stop' sender
stopListening() {
    if (!this.listening) return;

    // 1. Stop the local MediaRecorder and stream
    this.getDevices?.then(recorder => {
      if (recorder?.state !== 'inactive') {
        recorder.stream.getAudioTracks().forEach(track => track.stop());
        recorder.stop();
      }
      this.listening = false;
    });

    // 3. Clear all related timers (visuals already reset by scheduleStopListening)
    if (this.indicatorTimeout) clearTimeout(this.indicatorTimeout);
    if (this.releaseTimeout) clearTimeout(this.releaseTimeout);
    if (this.stopDelayTimeout) clearTimeout(this.stopDelayTimeout);

    this.releaseTimeout = null;
    this.stopDelayTimeout = null;
    this.hideMediaElementTimeout = null;

    // 4. Reset status text for final confirmation
    this.statusText = 'Microphone not active';
}

  // --- End of Debounce/Stop Logic ---

  setIndicator(ready = false) {
    let btn = this.activeMediaElement ? this.micButtonReply : this.micButton;
      if (ready && this.listening) {
          btn.classList.remove('starting');
          btn.classList.add('ready');
          this.statusText = 'Microphone is active and ready to record!';
      } else {
        btn.classList.add('starting');
        btn.classList.remove('ready');
        this.statusText = 'Microphone starting, please wait...';
      }
  }

  setLatestTranscription(message) {
    this.latestTranscription = message;
  }

  setupAudioPlayback() {
    this.audioMediaSource = new MediaSource();
    this.audioElement.src = URL.createObjectURL(this.audioMediaSource);

    this.audioMediaSource.addEventListener('sourceopen', () => {
        this.isAudioSourceOpen = true;
        const mimeType = 'audio/webm;codecs=opus';
        if (!MediaSource.isTypeSupported(mimeType)) {
            console.error(`HA-Intercom: MIME type ${mimeType} is not supported on this device.`);
            return;
        }
        this.audioSourceBuffer = this.audioMediaSource.addSourceBuffer(mimeType);

        this.audioSourceBuffer.addEventListener('updateend', () => {
            if (this.audioSourceBuffer && !this.audioSourceBuffer.updating && this.audioMediaSource.readyState === 'open') {
                this.audioElement.play().catch(e => {
                      console.warn('HA-Intercom: Playback prevented by browser policy (autoplay)', e);
                });
            }
        });

        this.audioElement.play().catch(e => console.warn('HA-Intercom: Autoplay failed:', e));
    });

    this.audioMediaSource.addEventListener('sourceclose', () => {
          this.isAudioSourceOpen = false;
          this.audioSourceBuffer = null;
          console.log('HA-Intercom: MediaSource closed.');
    });
  }

  setupVideoPlayback() {
    // Reuse MediaSource
    this.videoMediaSource = new MediaSource();
    this.videoElement.src = URL.createObjectURL(this.videoMediaSource);

    this.videoMediaSource.addEventListener('sourceopen', () => {
        this.isVideoSourceOpen = true; // Use a different flag for clarity

        // 2. Change MIME type to support video (vp8) and audio (opus)
        const mimeType = 'video/webm;codecs=vp8,opus';

        if (!MediaSource.isTypeSupported(mimeType)) {
            console.error(`HA-Video: MIME type ${mimeType} is not supported on this device.`);
            return;
        }

        // Use a new source buffer property for video
        this.videoSourceBuffer = this.videoMediaSource.addSourceBuffer(mimeType);

        this.videoSourceBuffer.addEventListener('updateend', () => {
            // Use the video source buffer
            if (this.videoSourceBuffer && !this.videoSourceBuffer.updating && this.videoMediaSource.readyState === 'open') {
                // Use the video element
                this.videoElement.play().catch(e => {
                    console.warn('HA-Video: Playback prevented by browser policy (autoplay)', e);
                });
            }
        });

        // Autoplay attempt (might be blocked by browser)
        this.videoElement.play().catch(e => console.warn('HA-Video: Autoplay failed:', e));
    });

    this.audioMediaSource.addEventListener('sourceclose', () => {
        this.isVideoSourceOpen = false; // Use the video flag
        this.videoSourceBuffer = null;
        console.log('HA-Video: MediaSource closed.');
    });
}

  async connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const host = window.location.host;

    console.log('HA-Intercom: Attempting to connect...');
    let access_token = await getAccessToken();
    this.ws = new WebSocket(`${protocol}://${host}/api/ha_intercom/ws?id=${this.CLIENT_ID}&token=${access_token}`);
    this.ws.binaryType = 'arraybuffer';

    this.connectTimer = setTimeout(() => {
      console.warn('HA-Intercom: Connection timeout. Retrying...');
      this.ws.close();
    }, this.connectTimeout);

    this.ws.onopen = () => {
      clearTimeout(this.connectTimer);
      console.log('HA-Intercom: WebSocket connected');
      this.ws?.send(this.createMessage({ ...this.config, type: 'register' }));
      this.startPingInterval();
    };

    this.ws.onmessage = (event) => {
      const { header, data } = this.decodeMessage(event.data);
      let { type, text, from, clients } = header;
      if (type === 'transcription') {
        this.setLatestTranscription(text);
      } else if (type === 'config') { // set Client Name and Entity_ID in UI
        let { name, entity_id } = header;
        this.NAME = name;
        this.ENTITY_ID = entity_id;
        this.displaySetup = false;
      } else if (type === 'setup') {
        this.displaySetup = true;
      } else if (type === 'clients') {
        this.CLIENTS = clients;
      } else if (type === 'stop') {
        this.setupAudioPlayback(); // reset audio
        this.setupVideoPlayback(); // reset video
      } else if (type === 'audio') {
        if (this.isAudioSourceOpen && this.audioSourceBuffer && !this.audioSourceBuffer.updating) {
            try {
              this.showMediaElement('audio', {from});
              this.audioSourceBuffer.appendBuffer(data);
            } catch (e) {
                console.error('HA-Intercom: Error appending audio buffer:', e);
            }
        }
      } else if (type === 'video') {
        if (this.isVideoSourceOpen && this.videoSourceBuffer && !this.videoSourceBuffer.updating) {
            try {
              this.showMediaElement('video', {from});
              this.videoSourceBuffer.appendBuffer(data);
            } catch (e) {
                console.error('HA-Intercom: Error appending video buffer:', e);
            }
        }
      }
    };

    this.ws.onerror = (err) => {
      console.error('HA-Intercom: WebSocket error:', err);
    };

    this.ws.onclose = () => {
      clearTimeout(this.connectTimer);
      this.stopPingInterval();
      if (!this.isManuallyClosed) {
        console.warn('HA-Intercom: WebSocket closed. Retrying...');
        setTimeout(() => this.connectWebSocket(), this.retryDelay);
      }
    };
  }

  closeWebSocket() {
    this.isManuallyClosed = true;
    if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
      this.ws.close();
    }
  }

  createMessage(header, payloadBuffer = new ArrayBuffer()) {
    const encoder = new TextEncoder();
    const target = header.target;
    const headerBytes = encoder.encode(JSON.stringify({name: this.NAME, ...header, target}));
    const payloadBytes = new Uint8Array(payloadBuffer);

    const headerLength = headerBytes.length;
    const totalLength = 4 + headerLength + payloadBytes.length;
    const buffer = new ArrayBuffer(totalLength);
    const view = new DataView(buffer);

    view.setUint32(0, headerLength, true);
    new Uint8Array(buffer, 4, headerLength).set(headerBytes);
    new Uint8Array(buffer, 4 + headerLength).set(payloadBytes);

    return buffer;
  }

  decodeMessage(buffer) {
    if (buffer.byteLength < 4) {
        throw new Error('Received buffer is too small to contain the JSON header length prefix.');
    }
    const view = new DataView(buffer);
    const jsonHeaderLength = view.getUint32(0, false);
    const headerStart = 4;
    const headerEnd = headerStart + jsonHeaderLength;
    if (buffer.byteLength < headerEnd) {
        throw new Error(`Buffer size (${buffer.byteLength}) is less than claimed header end (${headerEnd}). Data corrupted.`);
    }
    const jsonHeaderBuffer = buffer.slice(headerStart, headerEnd);
    const jsonString = new TextDecoder('utf-8').decode(jsonHeaderBuffer);
    const header = JSON.parse(jsonString);
    const data = buffer.slice(headerEnd);
    return { header, data };
  }

  checkCancelable(e) {
    if (e?.cancelable) {
      e.preventDefault();
    }
  }

  startPingInterval() {
      if (this.pingInterval) {
          clearInterval(this.pingInterval);
      }
      this.pingInterval = setInterval(() => {
          if (this.ws?.readyState === WebSocket.OPEN) {
              this.ws.send(this.createMessage({ type: 'ping' }));
          } else {
              this.stopPingInterval();
          }
      }, this.pingInterval);
  }

  stopPingInterval() {
      if (this.pingInterval) {
          clearInterval(this.pingInterval);
          this.pingInterval = null;
      }
  }

}

customElements.define('ha-intercom-card', HaIntercomCard);