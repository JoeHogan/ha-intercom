import * as fs from 'node:fs/promises';
const configPath = './config/config.json';

export async function updateConfig(key, updateCb) {
  try {
    let existingData = await getConfig();

    existingData[key] = updateCb(existingData[key]);

    const jsonString = JSON.stringify(existingData, null, 2);

    await fs.writeFile(configPath, jsonString, 'utf-8');
    console.log('JSON file updated successfully!');
    return existingData[key];
  } catch (error) {
    console.error('Error handling JSON file:', error);
  }
}

export async function getConfig() {
    let existingData = {};
    try {
      const fileContent = await fs.readFile(configPath, 'utf-8');
      existingData = JSON.parse(fileContent);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      console.log('File not found, creating new JSON file.');
    }
    return existingData;
}

export async function addKnownClient(id, {name, entity_id}) {
    const clients = await updateConfig('clients', (clients = {}) => {
        let configItem = clients[id] || {};
        let updatedConfigItem = {...configItem, name, entity_id};
        clients[id] = updatedConfigItem;
        return clients;
    });
    return clients[id];
}

export async function getKnownClients() {
    let config = await getConfig();
    return config.clients || {};
}

