'use strict';

import dgram from 'dgram';
import { Buffer } from 'buffer';
import { URL } from 'url';
import crypto from 'crypto';
import { genId } from '../util.js';
import * as torrentParser from './torrent-parser.js';

/**
 * Function to get peers from the tracker.
 * @param {Object} torrent - The torrent object.
 * @param {Function} callback - The callback function to process peers.
 */
export const getPeers = (torrent, callback) => {
    try {
        const socket = dgram.createSocket('udp4');
        const url = Buffer.from(torrent.announce).toString('utf8');
        console.log('Parsed announce URL:', url);

        // 1. Send connect request
        udpSendWithRetry(socket, buildConnReq(), url);

        socket.on('message', (response) => {
            try {
                if (respType(response) === 'connect') {
                    // 2. Receive and parse connect response
                    const connResp = parseConnResp(response);
                    // 3. Send announce request
                    const announceReq = buildAnnounceReq(connResp.connectionId, torrent);
                    udpSendWithRetry(socket, announceReq, url);
                } else if (respType(response) === 'announce') {
                    // 4. Parse announce response
                    const announceResp = parseAnnounceResp(response);
                    // 5. Pass peers to callback
                    callback(announceResp.peers);
                }
            } catch (err) {
                console.error('Error while processing UDP message:', err);
            }
        });
    } catch (err) {
        console.error('Error in getPeers function:', err);
    }
};

/**
 * Retries a function with exponential backoff.
 * @param {Function} fn - The function to retry.
 * @param {number} maxRetries - Maximum number of retries.
 * @returns {Promise} Resolves if fn succeeds, rejects if maxRetries are reached.
 */
const retryWithExponentialBackoff = async (fn, maxRetries = 8) => {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            if (attempt === maxRetries - 1) {
                throw error;
            }

            const delay = Math.pow(2, attempt) * 15 * 1000;
            console.log(`Attempt ${attempt + 1} failed. Retrying in ${delay / 1000} seconds...`);

            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
};

/**
 * Sends UDP messages with retry logic.
 * @param {dgram.Socket} socket - The UDP socket.
 * @param {Buffer} message - The message to send.
 * @param {string} rawUrl - The tracker URL.
 * @param {Function} callback - The callback after sending the message.
 */
const udpSendWithRetry = (socket, message, rawUrl, callback = () => {}) => {
    retryWithExponentialBackoff(() => {
        return new Promise((resolve, reject) => {
            try {
                const url = new URL(rawUrl);
                socket.send(message, 0, message.length, url.port, url.hostname, (err) => {
                    if (err) {
                        reject(err);
                    } else {
                        callback();
                        resolve();
                    }
                });
            } catch (err) {
                reject(err);
            }
        });
    }).catch(err => {
        console.error('All retry attempts failed:', err);
    });
};

/**
 * Determines the type of the response.
 * @param {Buffer} resp - The response buffer.
 * @returns {string} - The type of the response.
 */
const respType = (resp) => {
    const action = resp.readUInt32BE(0);
    if (action === 0) return 'connect';
    if (action === 1) return 'announce';
};

/**
 * Builds a connection request buffer.
 * @returns {Buffer} - The connection request buffer.
 */
const buildConnReq = () => {
    const buf = Buffer.alloc(16);
    buf.writeUInt32BE(0x417, 0); // connection magic number
    buf.writeUInt32BE(0x27101980, 4); // connection magic number continued
    buf.writeUInt32BE(0, 8); // action: connect
    crypto.randomBytes(4).copy(buf, 12);
    return buf;
};

/**
 * Parses the connection response.
 * @param {Buffer} resp - The connection response buffer.
 * @returns {Object} - The parsed connection response.
 */
const parseConnResp = (resp) => {
    return {
        action: resp.readUInt32BE(0),
        transactionId: resp.readUInt32BE(4),
        connectionId: resp.slice(8)
    };
};

/**
 * Builds an announce request buffer.
 * @param {Buffer} connId - The connection ID.
 * @param {Object} torrent - The torrent object.
 * @param {number} port - The port to use (default 6881).
 * @returns {Buffer} - The announce request buffer.
 */
const buildAnnounceReq = (connId, torrent, port = 6881) => {
    const buf = Buffer.allocUnsafe(98);

    connId.copy(buf, 0);
    buf.writeUInt32BE(1, 8); // action
    crypto.randomBytes(4).copy(buf, 12); // transaction id
    torrentParser.infoHash(torrent).copy(buf, 16); // info hash
    genId().copy(buf, 36); // peer id
    Buffer.alloc(8).copy(buf, 56); // downloaded
    torrentParser.size(torrent).copy(buf, 64); // left
    Buffer.alloc(8).copy(buf, 72); // uploaded
    buf.writeUInt32BE(0, 80); // event
    buf.writeUInt32BE(0, 84); // ip address
    crypto.randomBytes(4).copy(buf, 88); // key
    buf.writeInt32BE(-1, 92); // num want
    buf.writeUInt16BE(port, 96); // port

    return buf;
};

/**
 * Parses the announce response.
 * @param {Buffer} resp - The announce response buffer.
 * @returns {Object} - The parsed announce response.
 */
const parseAnnounceResp = (resp) => {
    const group = (iterable, groupSize) => {
        let groups = [];
        for (let i = 0; i < iterable.length; i += groupSize) {
            groups.push(iterable.slice(i, i + groupSize));
        }
        return groups;
    };

    return {
        action: resp.readUInt32BE(0),
        transactionId: resp.readUInt32BE(4),
        leechers: resp.readUInt32BE(8),
        seeders: resp.readUInt32BE(12),
        peers: group(resp.slice(20), 6).map(address => {
            return {
                ip: address.slice(0, 4).join('.'),
                port: address.readUInt16BE(4)
            };
        })
    };
};
