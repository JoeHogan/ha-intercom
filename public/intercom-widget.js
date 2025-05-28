import { LitElement, html, css } from 'https://unpkg.com/lit@latest?module';

export class IntercomWidget extends LitElement {
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
    `;
  }

  setConfig(config) {
      if (!config.target) {
      throw new Error("You need to specify a target for the intercom");
      }
      this.config = config;
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

  connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const host = window.location.host;

    console.log('Attempting to connect...');
    this.ws = new WebSocket(`${protocol}://${host}/api/intercom`);
    this.ws.binaryType = 'arraybuffer';

    this.connectTimer = setTimeout(() => {
      console.warn('Connection timeout. Retrying...');
      this.ws.close();
    }, this.connectTimeout);

    this.ws.onopen = () => {
      clearTimeout(this.connectTimer);
      console.log('WebSocket connected');
    };

    this.ws.onmessage = (event) => {
      this.setLatestTranscription(event.data);
    };

    this.ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };

    this.ws.onclose = () => {
      clearTimeout(this.connectTimer);
      if (!this.isManuallyClosed) {
        console.warn('WebSocket closed. Retrying...');
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
    this.ws?.send(this.createMessage({ type: 'start', target: this.TARGETS }));
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
        console.error('Recording error:', err);
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
}

customElements.define('intercom-widget', IntercomWidget);