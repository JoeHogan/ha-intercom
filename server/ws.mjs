export const getMessage = (data) => {
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength); // Convert to ArrayBuffer
    const view = new DataView(buffer);

    // Read 4-byte header length (little-endian)
    const headerLength = view.getUint32(0, true);

    // Extract header
    const headerBytes = new Uint8Array(buffer, 4, headerLength);
    const headerJson = new TextDecoder().decode(headerBytes);
    const header = JSON.parse(headerJson);

    // Extract payload
    const payloadOffset = 4 + headerLength;
    const payload = new Uint8Array(buffer, payloadOffset);

    return {header, payload};
};

export const encodeMessage = (header, data = null) => {
  const jsonString = JSON.stringify(header);
  const jsonBuffer = Buffer.from(jsonString, 'utf8');
  const headerLength = jsonBuffer.length;
  const headerLengthBuffer = Buffer.alloc(4);
  headerLengthBuffer.writeUInt32BE(headerLength, 0); 
  let dataBuffer = Buffer.alloc(0);
  if (data) {
      dataBuffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
  }
  return Buffer.concat([
    headerLengthBuffer,
    jsonBuffer,
    dataBuffer
  ]);
};