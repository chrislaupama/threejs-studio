import { Buffer } from 'node:buffer';

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const JSON_CHUNK_TYPE = 0x4e4f534a;
const BIN_CHUNK_TYPE = 0x004e4942;

function padToFourBytes(input: Buffer, fill: number): Buffer {
  const padding = (4 - (input.length % 4)) % 4;
  return padding === 0 ? input : Buffer.concat([input, Buffer.alloc(padding, fill)]);
}

function float32Buffer(values: readonly number[]): Buffer {
  const buffer = Buffer.alloc(values.length * 4);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  values.forEach((value, index) => view.setFloat32(index * 4, value, true));
  return buffer;
}

function uint16Buffer(values: readonly number[]): Buffer {
  const buffer = Buffer.alloc(values.length * 2);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  values.forEach((value, index) => view.setUint16(index * 2, value, true));
  return buffer;
}

export function makeTriangleGlb(): Buffer {
  const positions = float32Buffer([-0.5, 0, 0, 0.5, 0, 0, 0, 1, 0]);
  const normals = float32Buffer([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const indices = uint16Buffer([0, 1, 2]);
  const binaryPayload = Buffer.concat([positions, normals, indices]);
  const gltf = {
    asset: { version: '2.0', generator: 'ThreeJS Studio QA Fixture' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name: 'QA Triangle', mesh: 0 }],
    meshes: [{
      name: 'QA Triangle Mesh',
      primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }],
    }],
    materials: [{
      name: 'QA Teal',
      doubleSided: true,
      pbrMetallicRoughness: {
        baseColorFactor: [0.11, 0.82, 0.7, 1],
        metallicFactor: 0.1,
        roughnessFactor: 0.45,
      },
    }],
    buffers: [{ byteLength: binaryPayload.length }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.length, target: 34962 },
      { buffer: 0, byteOffset: positions.length, byteLength: normals.length, target: 34962 },
      { buffer: 0, byteOffset: positions.length + normals.length, byteLength: indices.length, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3', min: [-0.5, 0, 0], max: [0.5, 1, 0] },
      { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
  };
  const jsonChunk = padToFourBytes(Buffer.from(JSON.stringify(gltf), 'utf8'), 0x20);
  const binaryChunk = padToFourBytes(binaryPayload, 0x00);
  const totalLength = 12 + 8 + jsonChunk.length + 8 + binaryChunk.length;
  const glb = Buffer.alloc(totalLength);
  let offset = 0;
  glb.writeUInt32LE(GLB_MAGIC, offset); offset += 4;
  glb.writeUInt32LE(GLB_VERSION, offset); offset += 4;
  glb.writeUInt32LE(totalLength, offset); offset += 4;
  glb.writeUInt32LE(jsonChunk.length, offset); offset += 4;
  glb.writeUInt32LE(JSON_CHUNK_TYPE, offset); offset += 4;
  jsonChunk.copy(glb, offset); offset += jsonChunk.length;
  glb.writeUInt32LE(binaryChunk.length, offset); offset += 4;
  glb.writeUInt32LE(BIN_CHUNK_TYPE, offset); offset += 4;
  binaryChunk.copy(glb, offset);
  return glb;
}

export function makeExternalBufferGltf(): Buffer {
  return Buffer.from(JSON.stringify({
    asset: { version: '2.0' },
    buffers: [{ uri: 'mesh.bin', byteLength: 12 }],
    scenes: [{ nodes: [] }],
    scene: 0,
  }));
}
