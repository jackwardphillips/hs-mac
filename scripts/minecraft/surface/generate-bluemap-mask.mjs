#!/usr/bin/env node

import { readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { gunzipSync, inflateSync } from "node:zlib";
import { pathToFileURL } from "node:url";

const REGION_FILE = /^r\.(-?\d+)\.(-?\d+)\.mca$/;

function requireBytes(buffer, offset, length) {
  if (offset < 0 || length < 0 || offset + length > buffer.length) {
    throw new Error(`Invalid NBT bounds at ${offset} for ${length} bytes`);
  }
}

function readString(buffer, cursor) {
  requireBytes(buffer, cursor.offset, 2);
  const length = buffer.readUInt16BE(cursor.offset);
  cursor.offset += 2;
  requireBytes(buffer, cursor.offset, length);
  const value = buffer.toString("utf8", cursor.offset, cursor.offset + length);
  cursor.offset += length;
  return value;
}

function readLength(buffer, cursor, itemSize) {
  requireBytes(buffer, cursor.offset, 4);
  const length = buffer.readInt32BE(cursor.offset);
  cursor.offset += 4;
  if (length < 0 || length > Math.floor((buffer.length - cursor.offset) / itemSize)) {
    throw new Error(`Invalid NBT collection length ${length}`);
  }
  return length;
}

function skipPayload(buffer, cursor, type) {
  const fixedSizes = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 4, 6: 8 };
  if (fixedSizes[type]) {
    requireBytes(buffer, cursor.offset, fixedSizes[type]);
    cursor.offset += fixedSizes[type];
    return;
  }

  if (type === 7) {
    const length = readLength(buffer, cursor, 1);
    cursor.offset += length;
    return;
  }

  if (type === 8) {
    readString(buffer, cursor);
    return;
  }

  if (type === 9) {
    requireBytes(buffer, cursor.offset, 1);
    const childType = buffer[cursor.offset++];
    const length = readLength(buffer, cursor, 1);
    for (let index = 0; index < length; index += 1) {
      skipPayload(buffer, cursor, childType);
    }
    return;
  }

  if (type === 10) {
    while (true) {
      requireBytes(buffer, cursor.offset, 1);
      const childType = buffer[cursor.offset++];
      if (childType === 0) return;
      readString(buffer, cursor);
      skipPayload(buffer, cursor, childType);
    }
  }

  if (type === 11 || type === 12) {
    const itemSize = type === 11 ? 4 : 8;
    const length = readLength(buffer, cursor, itemSize);
    cursor.offset += length * itemSize;
    return;
  }

  throw new Error(`Unsupported NBT tag type ${type}`);
}

export function readInhabitedTime(buffer) {
  const cursor = { offset: 0 };
  requireBytes(buffer, cursor.offset, 1);
  const rootType = buffer[cursor.offset++];
  if (rootType !== 10) throw new Error(`Expected compound root, got tag ${rootType}`);
  readString(buffer, cursor);

  while (true) {
    requireBytes(buffer, cursor.offset, 1);
    const type = buffer[cursor.offset++];
    if (type === 0) return 0n;
    const name = readString(buffer, cursor);
    if (name === "InhabitedTime" && type === 4) {
      requireBytes(buffer, cursor.offset, 8);
      return buffer.readBigInt64BE(cursor.offset);
    }
    skipPayload(buffer, cursor, type);
  }
}

function decompressChunk(payload, compression) {
  if (compression === 1) return gunzipSync(payload);
  if (compression === 2) return inflateSync(payload);
  if (compression === 3) return payload;
  throw new Error(`Unsupported region compression type ${compression}`);
}

export function readInhabitedChunks(regionBuffer, regionX, regionZ) {
  requireBytes(regionBuffer, 0, 8192);
  const chunks = [];

  for (let index = 0; index < 1024; index += 1) {
    const headerOffset = index * 4;
    const sectorOffset = regionBuffer.readUIntBE(headerOffset, 3);
    if (sectorOffset === 0) continue;

    const chunkOffset = sectorOffset * 4096;
    requireBytes(regionBuffer, chunkOffset, 5);
    const length = regionBuffer.readUInt32BE(chunkOffset);
    if (length < 2) throw new Error(`Invalid chunk length ${length} at index ${index}`);
    requireBytes(regionBuffer, chunkOffset + 4, length);
    const compressionByte = regionBuffer[chunkOffset + 4];
    if ((compressionByte & 0x80) !== 0) {
      throw new Error(`External chunk storage is unsupported at index ${index}`);
    }
    const nbt = decompressChunk(
      regionBuffer.subarray(chunkOffset + 5, chunkOffset + 4 + length),
      compressionByte,
    );
    if (readInhabitedTime(nbt) > 0n) {
      chunks.push([
        regionX * 32 + (index % 32),
        regionZ * 32 + Math.floor(index / 32),
      ]);
    }
  }

  return chunks;
}

export function isEmptyRegionFile(fileStat) {
  return fileStat.size === 0;
}

export function bufferChunks(chunks, radius = 1) {
  const buffered = new Set();
  for (const [chunkX, chunkZ] of chunks) {
    for (let deltaZ = -radius; deltaZ <= radius; deltaZ += 1) {
      for (let deltaX = -radius; deltaX <= radius; deltaX += 1) {
        buffered.add(`${chunkX + deltaX},${chunkZ + deltaZ}`);
      }
    }
  }
  return buffered;
}

export function fillEnclosedHoles(chunkKeys) {
  const coordinates = [...chunkKeys].map((key) => key.split(",").map(Number));
  if (coordinates.length === 0) return new Set();

  const xs = coordinates.map(([chunkX]) => chunkX);
  const zs = coordinates.map(([, chunkZ]) => chunkZ);
  const minX = Math.min(...xs) - 1;
  const maxX = Math.max(...xs) + 1;
  const minZ = Math.min(...zs) - 1;
  const maxZ = Math.max(...zs) + 1;
  const exterior = new Set();
  const queue = [[minX, minZ]];

  for (let index = 0; index < queue.length; index += 1) {
    const [chunkX, chunkZ] = queue[index];
    const key = `${chunkX},${chunkZ}`;
    if (
      chunkX < minX || chunkX > maxX || chunkZ < minZ || chunkZ > maxZ ||
      chunkKeys.has(key) || exterior.has(key)
    ) {
      continue;
    }
    exterior.add(key);
    queue.push(
      [chunkX - 1, chunkZ],
      [chunkX + 1, chunkZ],
      [chunkX, chunkZ - 1],
      [chunkX, chunkZ + 1],
    );
  }

  const filled = new Set(chunkKeys);
  for (let chunkZ = minZ + 1; chunkZ < maxZ; chunkZ += 1) {
    for (let chunkX = minX + 1; chunkX < maxX; chunkX += 1) {
      const key = `${chunkX},${chunkZ}`;
      if (!exterior.has(key)) filled.add(key);
    }
  }
  return filled;
}

export function mergeChunksIntoRectangles(chunkKeys) {
  const rows = new Map();
  for (const key of chunkKeys) {
    const [chunkX, chunkZ] = key.split(",").map(Number);
    if (!rows.has(chunkZ)) rows.set(chunkZ, []);
    rows.get(chunkZ).push(chunkX);
  }

  const rectangles = [];
  let active = new Map();
  const sortedRows = [...rows.entries()].sort(([left], [right]) => left - right);

  for (const [chunkZ, chunkXs] of sortedRows) {
    chunkXs.sort((left, right) => left - right);
    const runs = [];
    let minX = chunkXs[0];
    let maxX = chunkXs[0];
    for (const chunkX of chunkXs.slice(1)) {
      if (chunkX === maxX + 1) {
        maxX = chunkX;
      } else {
        runs.push([minX, maxX]);
        minX = chunkX;
        maxX = chunkX;
      }
    }
    runs.push([minX, maxX]);

    const nextActive = new Map();
    const continued = new Set();
    for (const [runMinX, runMaxX] of runs) {
      const key = `${runMinX},${runMaxX}`;
      const existing = active.get(key);
      if (existing && existing.maxZ === chunkZ - 1) {
        existing.maxZ = chunkZ;
        nextActive.set(key, existing);
        continued.add(key);
      } else {
        nextActive.set(key, { minX: runMinX, maxX: runMaxX, minZ: chunkZ, maxZ: chunkZ });
      }
    }

    for (const [key, rectangle] of active) {
      if (!continued.has(key)) rectangles.push(rectangle);
    }
    active = nextActive;
  }

  rectangles.push(...active.values());
  return rectangles;
}

export function formatMask(rectangles, stats) {
  const lines = [
    "# Generated by scripts/minecraft/generate-bluemap-mask.mjs.",
    `# ${stats.inhabitedChunks} inhabited; ${stats.bufferedChunks} buffered; ${stats.filledChunks} after enclosed-hole fill; ${rectangles.length} rectangles.`,
    "min-inhabited-time: 0",
    "render-mask: [",
  ];
  for (const rectangle of rectangles) {
    lines.push("  {");
    lines.push("    type: box");
    lines.push(`    min-x: ${rectangle.minX * 16}`);
    lines.push(`    max-x: ${rectangle.maxX * 16 + 15}`);
    lines.push(`    min-z: ${rectangle.minZ * 16}`);
    lines.push(`    max-z: ${rectangle.maxZ * 16 + 15}`);
    lines.push("  }");
  }
  lines.push("]", "");
  return lines.join("\n");
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      throw new Error("Usage: generate-bluemap-mask.mjs --world PATH --output PATH --cache PATH");
    }
    values[key.slice(2)] = value;
  }
  if (!values.world || !values.output || !values.cache) {
    throw new Error("Usage: generate-bluemap-mask.mjs --world PATH --output PATH --cache PATH");
  }
  return values;
}

async function loadCache(cachePath) {
  try {
    const parsed = JSON.parse(await readFile(cachePath, "utf8"));
    return parsed.version === 1 && parsed.regions ? parsed : { version: 1, regions: {} };
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return { version: 1, regions: {} };
    throw error;
  }
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const regionDir = path.join(args.world, "region");
  const cache = await loadCache(args.cache);
  const nextCache = { version: 1, regions: {} };
  const inhabitedChunks = [];
  let cachedRegions = 0;
  let scannedRegions = 0;
  let emptyRegions = 0;

  const regionFiles = (await readdir(regionDir)).filter((name) => REGION_FILE.test(name)).sort();
  if (regionFiles.length === 0) throw new Error(`No region files found in ${regionDir}`);

  for (const name of regionFiles) {
    const match = REGION_FILE.exec(name);
    const filePath = path.join(regionDir, name);
    const fileStat = await stat(filePath);
    if (isEmptyRegionFile(fileStat)) {
      emptyRegions += 1;
      continue;
    }
    const cached = cache.regions[name];
    let chunks;
    if (cached?.mtimeMs === fileStat.mtimeMs && cached?.size === fileStat.size && Array.isArray(cached.chunks)) {
      chunks = cached.chunks;
      cachedRegions += 1;
    } else {
      chunks = readInhabitedChunks(await readFile(filePath), Number(match[1]), Number(match[2]));
      scannedRegions += 1;
    }
    inhabitedChunks.push(...chunks);
    nextCache.regions[name] = { mtimeMs: fileStat.mtimeMs, size: fileStat.size, chunks };
  }

  if (inhabitedChunks.length === 0) throw new Error("No inhabited chunks found; refusing to create an empty mask");
  const bufferedChunks = bufferChunks(inhabitedChunks, 1);
  const filledChunks = fillEnclosedHoles(bufferedChunks);
  const rectangles = mergeChunksIntoRectangles(filledChunks);
  const mask = formatMask(rectangles, {
    inhabitedChunks: inhabitedChunks.length,
    bufferedChunks: bufferedChunks.size,
    filledChunks: filledChunks.size,
  });

  await writeFile(`${args.output}.tmp`, mask, { mode: 0o644 });
  await rename(`${args.output}.tmp`, args.output);
  await writeFile(`${args.cache}.tmp`, `${JSON.stringify(nextCache)}\n`, { mode: 0o600 });
  await rename(`${args.cache}.tmp`, args.cache);
  console.log(
    `BlueMap mask: ${inhabitedChunks.length} inhabited -> ${bufferedChunks.size} buffered -> ${filledChunks.size} enclosed-fill chunks -> ${rectangles.length} rectangles; ` +
      `${scannedRegions} regions scanned, ${cachedRegions} cached, ${emptyRegions} empty skipped`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`BlueMap mask generation failed: ${error.message}`);
    process.exitCode = 1;
  });
}
