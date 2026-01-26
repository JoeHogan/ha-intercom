import * as fs from 'node:fs/promises';
const configPath = './config/config.json';

export async function updateConfig(key, updateCb) {
  try {
    let existingData = await getConfig();

    existingData[key] = updateCb(existingData[key]);

    const jsonString = JSON.stringify(existingData, null, 2);

    await fs.writeFile(configPath, jsonString, 'utf-8');
    console.log('Configuration updated successfully!');
    return existingData[key];
  } catch (error) {
    console.error('Error updating configuration:', error);
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

export async function addKnownClient(userId, {name, entity_id}) {
    const clients = await updateConfig('clients', (clients = {}) => {
        let configItem = clients[userId] || {};
        let updatedConfigItem = {...configItem, name, entity_id};
        clients[userId] = updatedConfigItem;
        return clients;
    });
    return clients[userId];
}

export async function removeKnownClient(userId) {
    const clients = await updateConfig('clients', (clients = {}) => {
        if(clients[userId]) {
          delete clients[userId];
        }
        return clients;
    });
    return true;
}

export async function getKnownClients() {
    let config: any = await getConfig();
    return config.clients || {};
}

