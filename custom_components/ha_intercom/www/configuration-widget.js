import { LitElement, html, css } from 'https://unpkg.com/lit@latest?module';

const CONFIG = {
    name: 'My Intercom',
    target: [
        {
            entity_id: 'media_player.cintia_s_tv',
            type: 'alexa',
            data: {
                type: 'announce'
            }
        },
        // {
        //     entity_id: 'media_player.esphome_voice_satellite_ebf478_voice_satellite_player',
        //     type: 'tts',
        //     voice: 'en_US-masterchief-medium'
        // },
        // {
        //     entity_id: 'media_player.esphome_voice_satellite_ebf478_voice_satellite_player',
        //     type: 'audio',
        // },
    ],
    hideStatus: false,
    hideTranscription: false,
};

class ConfigurationWidget extends LitElement {
  static get properties() {
    return {
      config: { type: Object },
    };
  }

  constructor() {
    super();
    this.config = CONFIG;
  }

  render() {
    return html`
      <ha-intercom-card .config=${this.config}></ha-intercom-card>
    `;
  }
}

customElements.define('configuration-widget', ConfigurationWidget);