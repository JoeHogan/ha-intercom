import { LitElement, html, css } from "https://unpkg.com/lit-element@4.1.1/lit-element.js?module";
import { getAccessToken } from "./refreshToken.js";

export class HaIntercomCard extends LitElement {
  static styles = css`
    :host {
      display: block;
      font-family: sans-serif;
      text-align: center;
      color: black;
    }

    #mic-indicator {
      width: 50px;
      height: 50px;
      border-radius: 50%;
      border: 0;
      background-color: rgba(0, 100, 150, 0.7);
      color: white;
      display: block;
      margin: 0 auto;
      animation: none;
      box-shadow: 0 0 10px rgba(0, 0, 255, 0.5);
      touch-action: none;
      user-select: none;
      -webkit-user-select: none;
    }

    #mic-indicator.starting {
      background-color: red;
      animation: blink 1s infinite;
      box-shadow: 0 0 10px rgba(255, 0, 0, 0.5);
    }

    #mic-indicator.ready {
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
      latestTranscription: { type: String }
    };
  }

  constructor() {
    super();
    this.isTouch = false;
    this.statusText = 'Microphone not active';
    this.latestTranscription = '';
    this.ws = null;
    this.retryDelay = 2000;
    this.connectTimeout = 5000;
    this.isManuallyClosed = false;
    this.listening = false;
    this.indicatorTimeout = null;
    this.getDevices = null;
    this.pingInterval = null;
    this.PING_INTERVAL_MS = 30000;
  }

  render() {
    return html`
      <button id="mic-indicator">
        <ha-icon icon="mdi:microphone"></ha-icon>
      </button>
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
      <audio id="audio-playback" style="display: none;"></audio>
    `;
  }

  setConfig(config) {
      if (!config.target) {
      throw new Error("You need to specify a target for the intercom");
      }
      this.config = config;
      this.ID = this.config.id || `auto_id_${Math.round(Math.random()*100000)}`;
      this.TARGETS = Array.isArray(this.config.target) ? this.config.target : [this.config.target];
  }

  firstUpdated() {
    if (!window.MediaRecorder) {
      alert('MediaRecorder is not supported on this device.');
      return;
    }
    const button = this.shadowRoot.querySelector('#mic-indicator');

    // all events
    button.addEventListener('click', this.checkCancelable.bind(this), { passive: false });

    // touch events
    button.addEventListener('touchstart', this.startListening.bind(this), { passive: false });
    button.addEventListener('touchend', this.stopListening.bind(this), { passive: false });
    button.addEventListener('touchcancel', this.stopListening.bind(this), { passive: false });

    // mouse events
    button.addEventListener('mousedown', this.startListening.bind(this), { passive: false });
    button.addEventListener('mouseup', this.stopListening.bind(this), { passive: false });
    button.addEventListener('mouseleave', this.stopListening.bind(this), { passive: false });

    if(!this.TARGETS) {
      this.setConfig(this.config);
    }
    this.connectWebSocket();
    this.initIndicator();
    this.setupAudioPlayback();
  }

  initIndicator() {
    if (this.indicatorTimeout) clearTimeout(this.indicatorTimeout);
    this.shadowRoot.getElementById('mic-indicator').classList.remove('starting', 'ready');
    this.statusText = 'Microphone not active';
  }

  setIndicator() {
    const indicator = this.shadowRoot.getElementById('mic-indicator');
    indicator.classList.add('starting');
    indicator.classList.remove('ready');
    this.statusText = 'Microphone starting, please wait...';

    this.indicatorTimeout = setTimeout(() => {
      if (this.listening) {
        indicator.classList.remove('starting');
        indicator.classList.add('ready');
        this.statusText = 'Microphone is active and ready to record!';
      }
    }, 2000);
  }

  setLatestTranscription(message) {
    this.latestTranscription = message;
  }

  setupAudioPlayback() {
    this.audioElement = this.shadowRoot.querySelector('#audio-playback');
    this.mediaSource = new MediaSource();
    this.audioElement.src = URL.createObjectURL(this.mediaSource);

    // This event fires when MediaSource is ready to receive SourceBuffer.
    this.mediaSource.addEventListener('sourceopen', () => {
        this.isSourceOpen = true;
        // The MIME type MUST match the output from your server (audio/mpeg for MP3)
        const mimeType = 'audio/mpeg';
        if (!MediaSource.isTypeSupported(mimeType)) {
            console.error(`HA-Intercom: MIME type ${mimeType} is not supported on this device.`);
            return;
        }
        this.sourceBuffer = this.mediaSource.addSourceBuffer(mimeType);

        // Handle when the buffer is ready to accept new data
        this.sourceBuffer.addEventListener('updateend', () => {
            if (!this.sourceBuffer.updating && this.mediaSource.readyState === 'open') {
                // Try to play as soon as we've added a chunk
                this.audioElement.play().catch(e => {
                      // Playback might fail if the user hasn't interacted with the page yet
                      console.warn('HA-Intercom: Playback prevented by browser policy (autoplay)', e);
                });
            }
        });

        // Start the audio stream once the first chunk arrives
        this.audioElement.play().catch(e => console.warn('HA-Intercom: Autoplay failed:', e));
    });

    this.mediaSource.addEventListener('sourceclose', () => {
          this.isSourceOpen = false;
          this.sourceBuffer = null;
          console.log('HA-Intercom: MediaSource closed.');
    });
  }

  async connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const host = window.location.host;

    console.log('HA-Intercom: Attempting to connect...');
    let access_token = await getAccessToken();
    this.ws = new WebSocket(`${protocol}://${host}/api/ha_intercom/ws?id=${this.ID}&token=${access_token}`);
    this.ws.binaryType = 'arraybuffer';

    this.connectTimer = setTimeout(() => {
      console.warn('HA-Intercom: Connection timeout. Retrying...');
      this.ws.close();
    }, this.connectTimeout);

    this.ws.onopen = () => {
      clearTimeout(this.connectTimer);
      console.log('HA-Intercom: WebSocket connected');
      this.startPingInterval();
    };

    this.ws.onmessage = (event) => {
      const { header, data } = this.decodeMessage(event.data);
      let { type, text } = header;
      if (type === 'transcription') {
        this.setLatestTranscription(text);
      } else if (type === 'audio') {
        if (this.isSourceOpen && this.sourceBuffer && !this.sourceBuffer.updating) {
            try {
                this.sourceBuffer.appendBuffer(data);
            } catch (e) {
                console.error('HA-Intercom: Error appending audio buffer:', e);
                // Often happens when the stream is not properly formatted or MediaSource closes
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
    const headerBytes = encoder.encode(JSON.stringify(header));
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
    const headerStart = 4; // JSON header starts after the 4-byte prefix
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
    if (e.cancelable) {
      e.preventDefault();
    }
  }

  startListening(e) {
    if (e.type === 'touchstart') {
      this.isTouch = true;
    } else if (e.type === 'mousedown' && this.isTouch) {
      return;
    }
    this.checkCancelable(e);

    this.listening = true;
    this.ws?.send(this.createMessage({ id: this.ID, type: 'start', target: this.TARGETS }));
    this.setIndicator();

    this.getDevices = navigator.mediaDevices.getUserMedia({ audio: true })
      .then(stream => new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' }))
      .then(recorder => {
        if (recorder?.state === 'inactive') {
          recorder.ondataavailable = e => {
            if (e.data.size > 0) {
              e.data.arrayBuffer().then(buffer => {
                this.ws?.send(this.createMessage({ type: 'data' }, buffer));
              });
            }
          };
          recorder.start(250);
        }
        return recorder;
      })
      .catch(err => {
        console.error('HA-Intercom: Recording error:', err);
        this.stopListening();
      });
  }

  stopListening(e) {
    if (e.type === 'touchend' || e.type === 'touchcancel') {
      this.isTouch = true;
    } else if (e.type === 'mouseup' && this.isTouch) {
      return;
    }
    this.checkCancelable(e);
    if (!this.listening) return;

    this.ws?.send(this.createMessage({ type: 'stop' }));
    this.getDevices?.then(recorder => {
      if (recorder?.state !== 'inactive') {
        recorder.stream.getAudioTracks().forEach(track => track.stop());
        recorder.stop();
      }
      this.listening = false;
    });
    this.initIndicator();
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
      }, this.PING_INTERVAL_MS);
  }

  stopPingInterval() {
      if (this.pingInterval) {
          clearInterval(this.pingInterval);
          this.pingInterval = null;
      }
  }

}

customElements.define('ha-intercom-card', HaIntercomCard);