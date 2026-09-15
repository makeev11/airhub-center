import { deflateSync } from "node:zlib";

// Neutral installation tile: only the word ЧАТ, no product mark or desktop asset.
const letters = [
  ["10001", "10001", "10001", "11111", "00001", "00001", "00001"],
  ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
];
const chunk = (type, bytes) => {
  const data = Buffer.concat([Buffer.from(type), bytes]);
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++)
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, data, checksum]);
};

/** Generate a deterministic monochrome PNG without artwork or font dependencies. */
export function chatTextIcon(size) {
  if (![180, 192, 512].includes(size))
    throw new Error("Unsupported chat icon size");
  const scale = Math.floor(size / 25);
  const left = Math.floor((size - 17 * scale) / 2);
  const top = Math.floor((size - 7 * scale) / 2);
  const pixels = Buffer.alloc((size * 3 + 1) * size, 255);
  for (let y = 0; y < size; y++) pixels[y * (size * 3 + 1)] = 0;
  letters.forEach((letter, index) => {
    letter.forEach((row, y) => {
      for (let x = 0; x < row.length; x++)
        if (row[x] === "1")
          for (let dy = 0; dy < scale; dy++)
            for (let dx = 0; dx < scale; dx++) {
              const offset =
                (top + y * scale + dy) * (size * 3 + 1) +
                1 +
                (left + (index * 6 + x) * scale + dx) * 3;
              pixels.fill(35, offset, offset + 3);
            }
    });
  });
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
