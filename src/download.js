import fs from 'fs';
import path from 'path';
import net from 'net';
import * as tracker from './tracker.js';
import * as message from './message.js';
import Pieces from './Pieces.js';
import Queue from './Queue.js';

// This function downloads the torrent
export default (torrent) => {
    // Set the path where the file will be saved
    const torrentName = Buffer.isBuffer(torrent.info.name) ? torrent.info.name.toString() : torrent.info.name;

    // Join the path correctly
    const downloadPath = path.join('D:', 'BittorrentClient', torrentName);
    const dirPath = path.dirname(downloadPath);

    // Ensure that the directory exists
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }

    // Open the torrent file and start downloading
    tracker.getPeers(torrent, peers => {
        const pieces = new Pieces(torrent);
        const file = fs.openSync(downloadPath, 'w');
        peers.forEach(peer => download(peer, torrent, pieces, file));
    });
};

// This function connects to each peer and starts downloading the pieces
const download = (peer, torrent, pieces, file) => {
    const socket = new net.Socket();
    socket.on('error', console.log);
    socket.connect(peer.port, peer.ip, () => {
        socket.write(message.buildHandshake(torrent));
    });

    const queue = new Queue(torrent);
    onWholeMsg(socket, (msg) => msgHandler(msg, socket, pieces, queue, file));
};

// This function checks if the full message has been received
const onWholeMsg = (socket, callback) => {
    let savedBuf = Buffer.alloc(0);
    let handshake = true;

    socket.on('data', (recvBuf) => {
        const msgLen = () => (handshake ? savedBuf.readUInt8(0) + 49 : savedBuf.readInt32BE(0) + 4);
        savedBuf = Buffer.concat([savedBuf, recvBuf]);

        while (savedBuf.length >= 4 && savedBuf.length >= msgLen()) {
            callback(savedBuf.slice(0, msgLen()));
            savedBuf = savedBuf.slice(msgLen());
            handshake = false;
        }
    });
};

// This function handles different message types
const msgHandler = (msg, socket, pieces, queue, file) => {
    if (isHandshake(msg)) {
        socket.write(message.buildInterested());
    } else {
        const m = message.parse(msg);

        if (m.id === 0) chokeHandler(socket);
        if (m.id === 1) unchokeHandler(socket, pieces, queue, file);
        if (m.id === 4) haveHandler(socket, pieces, queue, m.payload);
        if (m.id === 5) bitfieldHandler(socket, pieces, queue, m.payload);
        if (m.id === 7) pieceHandler(socket, pieces, queue, file, torrent, m.payload);
    }
};

const isHandshake = (msg) => (
    msg.length === msg.readUInt8(0) + 49 &&
    msg.toString('utf8', 1) === 'BitTorrent protocol'
);

const chokeHandler = (socket) => {
    socket.end();
};

const unchokeHandler = (socket, pieces, queue, file) => {
    queue.choked = false;
    requestPiece(socket, pieces, queue, file);
};

const haveHandler = (socket, pieces, queue, payload) => {
    const pieceIndex = payload.readUInt32BE(0);
    const queueEmpty = queue.length === 0;
    queue.queue(pieceIndex);
    if (queueEmpty) requestPiece(socket, pieces, queue, file);
};

const bitfieldHandler = (socket, pieces, queue, payload) => {
    const queueEmpty = queue.length === 0;
    payload.forEach((byte, i) => {
        for (let j = 0; j < 8; j++) {
            if (byte % 2) queue.queue(i * 8 + 7 - j);
            byte = Math.floor(byte / 2);
        }
    });
    if (queueEmpty) requestPiece(socket, pieces, queue, file);
};

// This function handles the downloaded piece
const pieceHandler = (socket, pieces, queue, file, torrent, pieceResp) => {
    console.log(pieceResp);
    pieces.addReceived(pieceResp);

    const offset = pieceResp.index * torrent.info['piece length'] + pieceResp.begin;
    fs.write(file, pieceResp.block, 0, pieceResp.block.length, offset, () => {});

    if (pieces.isDone()) {
        console.log('DONE!');
        socket.end();
        try { fs.closeSync(file); } catch (e) { }
    } else {
        requestPiece(socket, pieces, queue, file);
    }
};

// This function requests a piece from the peer
const requestPiece = (socket, pieces, queue, file) => {
    if (queue.choked) return null;

    while (queue.length()) {
        const pieceBlock = queue.deque();
        if (pieces.needed(pieceBlock)) {
            socket.write(message.buildRequest(pieceBlock));
            pieces.addRequested(pieceBlock);
            break;
        }
    }
};
