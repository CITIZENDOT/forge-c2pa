import { crc32 } from "crc"; // Use the 'crc' package


/**
 * PNG Signature Bytes (static)
 */
const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * Helper to write a Big Endian 32-bit unsigned integer
 */
function writeUint32BE(
  buffer: Uint8Array,
  offset: number,
  value: number
): void {
  const view = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength
  );
  view.setUint32(offset, value, false); // false for Big Endian
}

/**
 * Helper to read a Big Endian 32-bit unsigned integer
 */
function readUint32BE(buffer: Uint8Array, offset: number): number {
  const view = new DataView(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength
  );
  return view.getUint32(offset, false); // false for Big Endian
}

/**
 * Helper to convert string to UTF-8 Uint8Array
 */
function stringToUtf8Bytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

/**
 * Creates a PNG iTXt chunk.
 * iTXt format:
 *   Keyword:            1-79 bytes (character string)
 *   Null separator:     1 byte
 *   Compression flag:   1 byte (0 for uncompressed)
 *   Compression method: 1 byte (0 for deflate - ignored if flag is 0)
 *   Language tag:       0 or more bytes (character string)
 *   Null separator:     1 byte
 *   Translated keyword: 0 or more bytes (UTF-8 string)
 *   Null separator:     1 byte
 *   Text:               0 or more bytes (UTF-8 string)
 * @param keyword The keyword for the metadata (e.g., "Author", "RawMetadataJson")
 * @param value The UTF-8 text value of the metadata.
 * @returns A Uint8Array representing the full iTXt chunk (Length + Type + Data + CRC).
 */
function createITXtChunk(keyword: string, value: string): Uint8Array {
  if (keyword.length === 0 || keyword.length > 79) {
    throw new Error(
      `iTXt keyword must be between 1 and 79 bytes long. Received: "${keyword}"`
    );
  }
  if (keyword.indexOf("\0") !== -1) {
    throw new Error(
      `iTXt keyword cannot contain null characters. Received: "${keyword}"`
    );
  }

  const keywordBytes = stringToUtf8Bytes(keyword);
  const valueBytes = stringToUtf8Bytes(value);
  const nullSeparator = new Uint8Array([0]);
  const compressionFlag = new Uint8Array([0]); // 0 = uncompressed
  const compressionMethod = new Uint8Array([0]); // 0 = deflate (irrelevant here)
  const languageTagBytes = new Uint8Array([]); // Empty language tag
  const translatedKeywordBytes = new Uint8Array([]); // Empty translated keyword

  const chunkType = stringToUtf8Bytes("iTXt"); // 4 bytes

  const chunkData = new Uint8Array([
    ...keywordBytes,
    ...nullSeparator,
    ...compressionFlag,
    ...compressionMethod,
    ...languageTagBytes,
    ...nullSeparator,
    ...translatedKeywordBytes,
    ...nullSeparator,
    ...valueBytes,
  ]);

  const dataLength = chunkData.length;

  // Prepare buffer for CRC calculation (Chunk Type + Chunk Data)
  const bytesForCrc = new Uint8Array(chunkType.length + chunkData.length);
  bytesForCrc.set(chunkType, 0);
  bytesForCrc.set(chunkData, chunkType.length);

  // Calculate CRC32 using the 'crc' library
  const crc = crc32(bytesForCrc); // Directly get the CRC32 value

  // Create the full chunk buffer (Length + Type + Data + CRC)
  const chunkLength = 4 + chunkType.length + chunkData.length + 4;
  const chunkBuffer = new Uint8Array(chunkLength);
  const chunkView = new DataView(chunkBuffer.buffer); // Use view on the *new* buffer

  // Write Length (Big Endian) - Length of DATA section only
  writeUint32BE(chunkBuffer, 0, dataLength);
  // Write Chunk Type
  chunkBuffer.set(chunkType, 4);
  // Write Chunk Data
  chunkBuffer.set(chunkData, 8);
  // Write CRC (Big Endian)
  writeUint32BE(chunkBuffer, 8 + dataLength, crc);

  return chunkBuffer;
}

/**
 * Adds metadata to a PNG file ArrayBuffer using iTXt chunks.
 *
 * @param pngBuffer The ArrayBuffer of the original PNG file.
 * @param metadata An object where keys/values become iTXt chunks,
 *                 or an object `{ json: data }` where data is JSON stringified
 *                 into a single iTXt chunk with keyword "RawMetadataJson".
 * @returns A new ArrayBuffer containing the PNG with embedded metadata.
 * @throws Error if the input buffer is not a valid PNG or if metadata is invalid.
 */
export function addMetadataToPng(
  pngBuffer: ArrayBuffer,
  metadata: Record<string, string>
): ArrayBuffer {
  const pngBytes = new Uint8Array(pngBuffer);

  // 1. Validate PNG Signature
  if (
    pngBytes.length < 8 ||
    !pngBytes.slice(0, 8).every((byte, i) => byte === PNG_SIGNATURE[i])
  ) {
    throw new Error(
      "Invalid PNG signature. Input buffer is not a valid PNG file."
    );
  }

  // 2. Create Metadata Chunks
  const metadataChunks: Uint8Array[] = [];
  if ("json" in metadata) {
    // JSON mode
    if (typeof metadata.json !== "object" || metadata.json === null) {
      throw new Error("Metadata 'json' property must be a non-null object.");
    }
    try {
      const jsonString = JSON.stringify(metadata.json);
      metadataChunks.push(createITXtChunk("RawMetadataJson", jsonString));
    } catch (e) {
      throw new Error(
        `Failed to stringify JSON metadata: ${
          e instanceof Error ? e.message : e
        }`
      );
    }
  } else {
    // Key-Value mode
    for (const [key, value] of Object.entries(metadata)) {
      if (typeof value !== "string") {
        console.warn(`Skipping non-string metadata value for key "${key}"`);
        continue;
      }
      metadataChunks.push(createITXtChunk(key, value));
    }
  }

  if (metadataChunks.length === 0) {
    console.warn(
      "No valid metadata provided or generated. Returning original PNG buffer."
    );
    return pngBuffer; // Or throw an error if metadata is required
  }

  // 3. Find Insertion Point (before first IDAT or IEND)
  let insertionOffset = -1;
  let currentOffset = 8; // Start after PNG signature

  while (currentOffset < pngBytes.length) {
    const dataLength = readUint32BE(pngBytes, currentOffset);
    const typeOffset = currentOffset + 4;
    const dataOffset = typeOffset + 4;
    const crcOffset = dataOffset + dataLength;
    const nextChunkOffset = crcOffset + 4;

    // Basic bounds check
    if (typeOffset + 4 > pngBytes.length || nextChunkOffset > pngBytes.length) {
      // Check if we are at a potentially valid IEND chunk (0 length data)
      if (dataLength === 0 && typeOffset + 4 <= pngBytes.length) {
        const chunkTypeBytes = pngBytes.slice(typeOffset, typeOffset + 4);
        const chunkType = new TextDecoder().decode(chunkTypeBytes);
        if (chunkType === "IEND") {
          // Found IEND right at the end, insertion point is before it
          insertionOffset = currentOffset;
          break;
        }
      }
      throw new Error(
        `Invalid PNG structure: Chunk offset ${currentOffset} length ${dataLength} extends beyond file boundary or invalid structure.`
      );
    }

    const chunkTypeBytes = pngBytes.slice(typeOffset, typeOffset + 4);
    const chunkType = new TextDecoder().decode(chunkTypeBytes); // ASCII is fine here

    // Insert before the first IDAT chunk
    if (chunkType === "IDAT") {
      insertionOffset = currentOffset;
      break;
    }
    // If we reach IEND without finding IDAT, insert before IEND
    if (chunkType === "IEND") {
      insertionOffset = currentOffset;
      break;
    }

    currentOffset = nextChunkOffset;
  }

  if (insertionOffset === -1) {
    // This might happen if the loop finishes without finding IDAT or IEND,
    // which indicates a truncated or invalid PNG.
    throw new Error(
      "Invalid PNG structure: Could not find IEND chunk or suitable insertion point (IDAT)."
    );
  }

  // 4. Construct the New PNG Buffer
  const totalMetadataLength = metadataChunks.reduce(
    (sum, chunk) => sum + chunk.length,
    0
  );
  const newPngLength = pngBytes.length + totalMetadataLength;
  const newPngBytes = new Uint8Array(newPngLength);

  // Copy bytes before insertion point
  newPngBytes.set(pngBytes.slice(0, insertionOffset), 0);

  // Insert metadata chunks
  let currentWriteOffset = insertionOffset;
  for (const chunk of metadataChunks) {
    newPngBytes.set(chunk, currentWriteOffset);
    currentWriteOffset += chunk.length;
  }

  // Copy bytes from insertion point to the end
  newPngBytes.set(pngBytes.slice(insertionOffset), currentWriteOffset);

  return newPngBytes.buffer;
}
