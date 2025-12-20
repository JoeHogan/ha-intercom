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
      color: rgba(0, 100, 150, 1);
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
      background-color: #ccc;
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
        background-color: black;
        color: white;

        &.open {
          position: relative;
          height: unset;
          width: 100%;
          margin: auto;
          z-index: 11;

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
            background-color: rgba(255, 255, 255, 0.25);
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

      &.fixed {
        .message-container {
          &.open {
            position: fixed;
            height: unset;
            width: 25%;
            min-width: 300px;
            bottom: 10px;
            right: 10px;
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

          .toggle-menu {
            .btn {
              background-color: rgba(0, 0, 0, 0.5);
            }
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
  `;

  static get properties() {
    return {
      hass: {},
      config: {},
      statusText: { type: String },
      latestTranscription: { type: String },
      invalidConfig: { type: Object },
      displaySetup: { type: Boolean },
      displayConfig: { type: Boolean },
      open: { type: Boolean },
      fullscreen: { type: Boolean },
      outgoingMedia: { type: Object },
      incomingMedia: { type: Object },
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
    this.incomingMedia = null;
    this.outgoingMedia = null;
    this.invalidConfig = null;
    this.displaySetup = false;
    this.displayConfig = false;
    this.CLIENTS = [];
    this.TARGETS = [];
    this.ws = null;
    this.retryDelay = 2000;
    this.connectTimeout = 5000;
    this.isManuallyClosed = false;
    this.indicatorTimeout = null;
    this.getDevices = null;
    this.pingInterval = null;
    this.pingInterval = 30000;
    this.releaseTimeout = null;
    this.stopDelayTimeout = null;
    this.debounceTime = 500;
    this.recordInterval = 250;
    this.stopDelay = 250;
    this.position = null;
    this.open = true;
    this.fullscreen = false;
    this.blockedSessions = [];
    this.hideActiveElementDelay = 5000;
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
    this.videoMediaTargets = [
      {
        source: 'incomingVideoMediaSource',
        element: 'incomingVideoElement',
        isOpen: 'isIncomingVideoSourceOpen',
        buffer: 'incomingVideoSourceBuffer'
      },
      {
        source: 'outgoingVideoMediaSource',
        element: 'outgoingVideoElement',
        isOpen: 'isOutgoingVideoSourceOpen',
        buffer: 'outgoingVideoSourceBuffer'
      },
    ];
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
                ${client.video ? html`<button type="button" class="btn video" @click="${this.startListeningClient.bind(this, client, 'video')}">
                  <ha-icon icon="mdi:video"></ha-icon>
                </button>` : null}
                <button type="button" class="btn audio" @click="${this.startListeningClient.bind(this, client, 'audio')}">
                  <ha-icon icon="mdi:microphone"></ha-icon>
                </button>
              </div>
            `
          })}
          ${this.TARGETS.map(target => {
            return html`
              <div class="list-item target">
                <div>${target.name || 'unknown'}</div>
                ${target.video ? html`<button type="button" class="btn video" @click="${this.startListening.bind(this, target, 'video')}">
                  <ha-icon icon="mdi:video"></ha-icon>
                </button>` : null}
                <button type="button" class="btn audio" @click="${this.startListening.bind(this, target, 'audio')}">
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
        <div class="message-container ${this.incomingMedia || this.outgoingMedia ? 'open' : 'closed'} ${this.fullscreen ? 'fullscreen' : ''}">

          <div class="actions left">
            <button class="btn fullscreen" @click="${() => this.toggleFullscreen()}">
              ${this.fullscreen ? html`<ha-icon icon="mdi:fullscreen-exit"></ha-icon>` : html`<ha-icon icon="mdi:fullscreen"></ha-icon>`}
            </button>
          </div>
          <div class="actions right">
            <button class="btn close-response" @click="${this.closeMediaWindow}">
              <ha-icon icon="mdi:close"></ha-icon>
            </button>
            ${this.incomingMedia && !this.outgoingMedia
              ? html`
                <button type="button" class="btn audio" @click="${this.startListeningClient.bind(this, this.incomingMedia.from, 'video')}">
                    <ha-icon icon="mdi:video"></ha-icon>
                  </button>
                  <button type="button" class="btn audio" @click="${this.startListeningClient.bind(this, this.incomingMedia.from, 'audio')}">
                    <ha-icon icon="mdi:microphone"></ha-icon>
                  </button>
              `
              : null
            }
          </div>
          <div class="header">Message ${this.incomingMedia ? 'From' : 'To'}: <strong>${this.incomingMedia ? (this.incomingMedia?.from?.name || this.incomingMedia?.from?.entity_id || 'unknown') : (this.outgoingMedia?.to?.name || this.outgoingMedia?.to?.entity_id || 'unknown')}</strong></div>

          <div class="av-container ${this.incomingMedia?.type || ''}">
            ${this.incomingMedia?.type === 'audio' ? this.audioElement : null}
            ${this.incomingMedia?.type === 'audio' || (!this.incomingMedia && this.outgoingMedia?.type === 'audio')
              ? html`
                  <div class="img-container">
                    <img src="/ha_intercom/sound.gif" alt="Incoming audio">
                  </div>
              `
              : null
            }
            ${this.incomingMedia?.type === 'video' ? this.incomingVideoElement : null}
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
        </div>
      </div>
    `;
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
        this.display = this.config.display && ['default', 'collapse', 'single'].indexOf(this.config.display.trim().toLowerCase()) > -1 ? this.config.display.trim().toLowerCase() : 'default';
        this.position = this.config.position && ['fixed', 'inline'].indexOf(this.config.position.trim().toLowerCase()) > -1 ? this.config.position.trim().toLowerCase() : 'fixed';
        this.open = this.display === 'collapse' ? false : true;
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

  toggleMenu(state = undefined) {
    if (state !== undefined) {
      this.open = state;
    } else {
      this.open = !this.open;
    }
    return this.open;
  }

  toggleConfig(open = undefined) {
    if (open !== undefined) {
      this.displayConfig = open ? true : false;
    } else {
      this.displayConfig = !this.displayConfig;
    }
    return this.displayConfig;
  }

  toggleFullscreen(open = undefined) {
    if (open !== undefined) {
      this.fullscreen = open ? true : false;
    } else {
      this.fullscreen = !this.fullscreen;
    }
    return this.fullscreen;
  }

  resetConfig() {
    this.ws?.send(this.createMessage({ type: 'reset', clientId: this.CLIENT_ID }));
    this.displaySetup = true;
    this.toggleConfig(false);
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
    btn.addEventListener('touchstart', this.startListeningSingle.bind(this), { passive: false });
    btn.addEventListener('touchcancel', this.handleButtonRelease.bind(this), { passive: false });
    btn.addEventListener('touchend', this.handleButtonRelease.bind(this), { passive: false });

    // mouse events
    btn.addEventListener('mousedown', this.startListeningSingle.bind(this), { passive: false });
    btn.addEventListener('mouseup', this.handleButtonRelease.bind(this), { passive: false });
    btn.addEventListener('mouseleave', this.handleButtonRelease.bind(this), { passive: false });

  }

  // Resets the visual indicator and status text to the default state
  resetVisuals() {
    let btn = this.micButton;
    btn.classList.remove('starting', 'ready');
    this.statusText = 'Microphone not active';
  }

  blockSession(wssId) {
    this.blockedSessions.push(wssId);
    setTimeout(() => {
      this.blockedSessions = this.blockedSessions.filter(item => item !== wssId);
    }, 5000);
  }

  isBlockedSession(wssId) {
    if (!wssId) {
      return false;
    }
    return this.blockedSessions.indexOf(wssId) > -1 ? true : false;
  }

  closeMediaWindow() {
    if (this.hideMediaElementTimeout) {
      clearTimeout(this.hideMediaElementTimeout);
    }
    if (this.incomingMedia?.wssId) {
      let wssId = this.incomingMedia.wssId;
      this.blockSession(wssId);
      this.ws?.send(this.createMessage({ wssId, type: 'stop' }));
    }
    this.incomingMedia = null;
    this.toggleFullscreen(false);
    this.handleStopListening();
  }

  toggleListening(e) {
    if (this.outgoingMedia) {
      this.handleStopListening(e);
    } else {
      this.startListening(e);
    }
  }

  startListeningClient({ name, entity_id }, type) {
    this.startListening({ name, entity_id, entities: [{ entity_id: `ha_client.${entity_id}`, type }] }, type);
  }

  startListeningSingle(e) {
    this.checkCancelable(e);

    // Reliable Events: Block redundant events and track state
    if (e.type === 'touchstart') {
      this.isTouchDown = true;
      this.isMouseDown = false;
    } else if (e.type === 'mousedown') {
      if (this.isTouchDown) return;
      this.isMouseDown = true;
    }
    let target = this.TARGETS.length ? this.TARGETS[0] : null;
    if (!target) {
      console.error(`HA-Intercom: You must define at least one target entity.`);
      return;
    }
    this.startListening(target, 'audio');
  }

  startListening(target, mediaType = 'audio') {
    if (this.outgoingMedia) return;

    this.outgoingMedia = {
      type: mediaType,
      to: target,
    };
    this.toggleMenu(false); // close the menu
    target = this.incomingMedia?.from?.id ? {name: this.incomingMedia.from.name, entities: [{ entity_id: `ha_client.${this.incomingMedia.from.id}` }] } : target;
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
                if (mediaType === 'video') {
                  try {
                    this.outgoingVideoSourceBuffer?.appendBuffer(buffer);
                  } catch (e) {
                    console.error(`HA-Intercom: ${e}`);
                  }
                }
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
        this.stopListening(); // Call release handler to clean up state immediately
      });
  }

handleStopListening(target) {
  if (!this.outgoingMedia) return;
  this.scheduleStopListening();
}

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

  this.incomingMedia = {
    type,
    from: clientInfo.from,
    wssId: clientInfo.wssId
  };

  if (this.hideMediaElementTimeout) {
      clearTimeout(this.hideMediaElementTimeout);
  }

  // Delayed Stop: Schedule the actual stop with a delay
  this.hideMediaElementTimeout = setTimeout(() => {
    if (this.outgoingMedia) { // assume user is replying...
      this.showMediaElement(type, clientInfo);
    } else {
      this.incomingMedia = null;
      if (!this.outgoingMedia) {
        this.toggleFullscreen(false);
      }
      this.hideMediaElementTimeout = null;
    }
  }, this.hideActiveElementDelay);
}

// The final cleanup and 'stop' sender
stopListening() {
    if (!this.outgoingMedia) return;

    // 1. Stop the local MediaRecorder and stream
    this.getDevices?.then(recorder => {
      if (recorder && recorder?.state !== 'inactive') {
        recorder.stream?.getAudioTracks().forEach(track => track.stop());
        recorder.stop();
      }
    });

    // 3. Clear all related timers (visuals already reset by scheduleStopListening)
    if (this.releaseTimeout) clearTimeout(this.releaseTimeout);
    if (this.stopDelayTimeout) clearTimeout(this.stopDelayTimeout);

    this.outgoingMedia = null;
    if (!this.incomingMedia) {
      this.toggleFullscreen(false);
    }
    this.releaseTimeout = null;
    this.stopDelayTimeout = null;
    this.hideMediaElementTimeout = null;

    // 4. Reset status text for final confirmation
    this.statusText = 'Microphone not active';
}

  // --- End of Debounce/Stop Logic ---

  setIndicator(ready = false) {
    let btn = this.micButton;
      if (ready && this.outgoingMedia) {
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

        this.audioMediaSource.addEventListener('sourceclose', () => {
          this.isAudioSourceOpen = false;
          this.audioSourceBuffer = null;
          console.log('HA-Intercom: MediaSource closed.');
        });

        this.audioElement.play().catch(e => console.warn('HA-Intercom: Autoplay failed:', e));
    });

  }

  setupVideoPlayback() {
    const mimeType = 'video/webm;codecs=vp8,opus';
    this.videoMediaTargets.forEach(({ source, element, isOpen, buffer }) => {

      // Reuse MediaSource
      this[source] = new MediaSource();
      this[element].src = URL.createObjectURL(this[source]);

      this[source].addEventListener('sourceopen', () => {
        this[isOpen] = true; // Use a different flag for clarity

        // 2. Change MIME type to support video (vp8) and audio (opus)

        if (!MediaSource.isTypeSupported(mimeType)) {
          console.error(`HA-Video: MIME type ${mimeType} is not supported on this device.`);
          return;
        }

        // Use a new source buffer property for video
        this[buffer] = this[source].addSourceBuffer(mimeType);

        this[buffer].addEventListener('updateend', () => {
          // Use the video source buffer
          if (this[buffer] && !this[buffer].updating && this[source].readyState === 'open') {
            // Use the video element
            this[element].play().catch(e => {
              console.warn('HA-Video: Playback prevented by browser policy (autoplay)', e);
            });
          }
        });

        this[buffer].addEventListener('sourceclose', () => {
          this[isOpen] = false; // Use the video flag
          this[buffer] = null;
          console.log('HA-Video: MediaSource closed.');
        });

        // Autoplay attempt (might be blocked by browser)
        this[element].play().catch(e => console.warn('HA-Video: Autoplay failed:', e));
      });

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
      let { type, text, wssId, from, clients } = header;
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
        this.handleStopListening();
        this.setupAudioPlayback(); // reset audio
        this.setupVideoPlayback(); // reset video
      } else if (type === 'audio') {
        if (this.isAudioSourceOpen && this.audioSourceBuffer && !this.audioSourceBuffer.updating && !this.isBlockedSession(wssId)) {
            try {
              this.showMediaElement('audio', { ...{ from }, wssId});
              this.audioSourceBuffer.appendBuffer(data);
            } catch (e) {
                console.error('HA-Intercom: Error appending audio buffer:', e);
            }
        }
      } else if (type === 'video') {
        if (this.isIncomingVideoSourceOpen && this.incomingVideoSourceBuffer && !this.incomingVideoSourceBuffer.updating && !this.isBlockedSession(wssId)) {
            try {
              this.showMediaElement('video', { ...{ from }, wssId});
              this.incomingVideoSourceBuffer.appendBuffer(data);
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

  // Handles the first stage of release (debounce)
  handleButtonRelease(e) {
    if (!this.outgoingMedia) return;
    this.checkCancelable(e);

    // Reliable Events: Block redundant release events
    if (e.type === 'touchend' || e.type === 'touchcancel') {
        if (!this.isTouchDown) return;
        this.isTouchDown = false;
    } else if (e.type === 'mouseup' || e.type === 'mouseleave') {
        if (!this.isMouseDown) return;
        if (this.isTouchDown) return;
        this.isMouseDown = false;
    }

    // If both flags are clear, but we are still listening, schedule the stop process
    if (!this.isMouseDown && !this.isTouchDown && this.outgoingMedia) {

        // Clear any existing release timeout to prevent double scheduling
        if (this.releaseTimeout) {
            clearTimeout(this.releaseTimeout);
        }

        // Debounce: Start the release timer (500ms)
        this.releaseTimeout = setTimeout(() => {
            this.releaseTimeout = null;

            // Debounce period expired: reset visuals and schedule stop command
            this.scheduleStopListening();
        }, this.debounceTime);
    }
  }

}

customElements.define('ha-intercom-card', HaIntercomCard);