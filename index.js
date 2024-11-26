'use strict';

// Import required modules
import fs from 'fs';
import bencode from 'bencode';
import { open as openTorrent} from './src/torrent-parser.js';
import download from './src/download.js';


// Read and decode the torrent file

const torrent = openTorrent(process.argv[2]);

download(torrent, torrent.info.name);

// getPeers(torrent,peers => {
//     console.log('list of peers: ', peers);
// })
