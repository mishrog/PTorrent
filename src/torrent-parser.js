'use strict'

import fs from 'fs';
import bencode from 'bencode';
import crypto from 'crypto';
import bigInt from 'big-integer';

export const open = (filepath) => {
    return bencode.decode(fs.readFileSync(filepath));
};

export const infoHash = torrent => {
    const info = bencode.encode(torrent.info);
    return crypto.createHash('sha1').update(info).digest();
}

export const size = (torrent) => {
    // Calculate the size in bytes
    const size = torrent.info.files 
      ? torrent.info.files.map(file => file.length).reduce((a, b) => a + b)
      : torrent.info.length;
  
    // Convert size to a big integer
    const bigSize = bigInt(size);
  
    // Convert the big integer to an 8-byte buffer
    const buffer = Buffer.alloc(8);
    const bigSizeBuffer = bigSize.toArray(256).value; // Convert big integer to an array of bytes (base 256)
  
    // Copy bytes to 8-byte buffer (left-pad with zeroes if needed)
    buffer.set(bigSizeBuffer, 8 - bigSizeBuffer.length);
  
    return buffer;
  };


export const BLOCK_LEN = 2 ** 14;

export const pieceLen = (torrent, pieceIndex) => {
  const totalLength = bigInt(torrent.size);  // Assuming torrent.size is a valid property
  const pieceLength = torrent.info['piece length'];

  const lastPieceLength = totalLength.mod(pieceLength);
  const lastPieceIndex = totalLength.divide(pieceLength).toJSNumber();

  return lastPieceIndex === pieceIndex ? lastPieceLength.toJSNumber() : pieceLength;
};

export const blocksPerPiece = (torrent, pieceIndex) => {
  const pieceLength = pieceLen(torrent, pieceIndex);
  return Math.ceil(pieceLength / BLOCK_LEN);
};

export const blockLen = (torrent, pieceIndex, blockIndex) => {
  const pieceLength = pieceLen(torrent, pieceIndex);

  const lastPieceLength = pieceLength.mod(BLOCK_LEN);
  const lastPieceIndex = Math.floor(pieceLength.divide(BLOCK_LEN).toJSNumber());

  return blockIndex === lastPieceIndex ? lastPieceLength.toJSNumber() : BLOCK_LEN;
};

