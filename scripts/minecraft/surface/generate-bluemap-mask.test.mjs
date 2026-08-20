import assert from "node:assert/strict";
import test from "node:test";
import { deflateSync } from "node:zlib";

import {
  bufferChunks,
  fillEnclosedHoles,
  formatMask,
  isEmptyRegionFile,
  mergeChunksIntoRectangles,
  readInhabitedChunks,
  readInhabitedTime,
} from "./generate-bluemap-mask.mjs";

function chunkNbt(inhabitedTime) {
  const rootName = Buffer.alloc(2);
  const tagName = Buffer.from("InhabitedTime");
  const nameLength = Buffer.alloc(2);
  nameLength.writeUInt16BE(tagName.length);
  const value = Buffer.alloc(8);
  value.writeBigInt64BE(BigInt(inhabitedTime));
  return Buffer.concat([Buffer.from([10]), rootName, Buffer.from([4]), nameLength, tagName, value, Buffer.from([0])]);
}

function regionWithChunks(chunks) {
  const header = Buffer.alloc(8192);
  const sectors = [header];
  let sectorOffset = 2;
  for (const [index, inhabitedTime] of chunks) {
    const compressed = deflateSync(chunkNbt(inhabitedTime));
    const length = compressed.length + 1;
    const sectorCount = Math.ceil((length + 4) / 4096);
    header.writeUIntBE(sectorOffset, index * 4, 3);
    header[index * 4 + 3] = sectorCount;
    const sector = Buffer.alloc(sectorCount * 4096);
    sector.writeUInt32BE(length, 0);
    sector[4] = 2;
    compressed.copy(sector, 5);
    sectors.push(sector);
    sectorOffset += sectorCount;
  }
  return Buffer.concat(sectors);
}

test("reads InhabitedTime from chunk NBT", () => {
  assert.equal(readInhabitedTime(chunkNbt(42)), 42n);
  assert.equal(readInhabitedTime(chunkNbt(0)), 0n);
});

test("reads only inhabited chunks from a region", () => {
  const region = regionWithChunks([[1, 12], [2, 0], [35, 7]]);
  assert.deepEqual(readInhabitedChunks(region, 0, 0), [[1, 0], [3, 1]]);
});

test("identifies zero-byte region placeholders without treating them as world data", () => {
  assert(isEmptyRegionFile({ size: 0 }));
  assert(!isEmptyRegionFile({ size: 8192 }));
});

test("one-chunk buffer fills isolated holes and merges to one rectangle", () => {
  const buffered = bufferChunks([[1, 1], [3, 1]], 1);
  assert(buffered.has("2,1"));
  assert.deepEqual(mergeChunksIntoRectangles(buffered), [
    { minX: 0, maxX: 4, minZ: 0, maxZ: 2 },
  ]);
});

test("preserves identical horizontal runs separated by an empty row", () => {
  assert.deepEqual(mergeChunksIntoRectangles(new Set(["1,1", "1,3"])), [
    { minX: 1, maxX: 1, minZ: 1, maxZ: 1 },
    { minX: 1, maxX: 1, minZ: 3, maxZ: 3 },
  ]);
});

test("fills enclosed chunks but preserves gaps open to the exterior", () => {
  const ring = new Set();
  for (let coordinate = 0; coordinate <= 4; coordinate += 1) {
    ring.add(`${coordinate},0`);
    ring.add(`${coordinate},4`);
    ring.add(`0,${coordinate}`);
    ring.add(`4,${coordinate}`);
  }
  const filled = fillEnclosedHoles(ring);
  assert.equal(filled.size, 25);
  assert(filled.has("2,2"));

  ring.delete("2,0");
  const open = fillEnclosedHoles(ring);
  assert(!open.has("2,2"));
});

test("formats chunk rectangles as inclusive block masks", () => {
  const output = formatMask([{ minX: -1, maxX: 1, minZ: 2, maxZ: 3 }], {
    inhabitedChunks: 1,
    bufferedChunks: 9,
    filledChunks: 9,
  });
  assert.match(output, /min-inhabited-time: 0/);
  assert.match(output, /min-x: -16/);
  assert.match(output, /max-x: 31/);
  assert.match(output, /min-z: 32/);
  assert.match(output, /max-z: 63/);
});
