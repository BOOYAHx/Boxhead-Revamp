// Resolved server addresses: window.BOXHEAD_CONFIG (config.js), then
// ?bridge=...&api=... in the page URL, then defaults next to the page host.

const user = window.BOXHEAD_CONFIG || {};
const params = new URLSearchParams(location.search);
const secure = location.protocol === 'https:';
const host = location.hostname || '127.0.0.1';

export const BRIDGE_URL = params.get('bridge') || user.bridgeUrl || `${secure ? 'wss' : 'ws'}://${host}:8081/`;
export const API_URL = params.get('api') || user.apiUrl || `${secure ? 'https' : 'http'}://${host}:8081/api/`;
// Bounty rankings (mostwanted.xml), forwarded by BBHServer.py next to the API.
export const MOST_WANTED_URL = params.get('mostwanted') || user.mostWantedUrl || API_URL.replace(/api\/?$/, 'assets/mostwanted.xml');
// Name shown on the server select screen and in the lobby welcome line.
export const SERVER_NAME = user.serverName || 'Squaresville';
// Guns, ammo and upgrades cost nothing in the shop.
export const FREE_GUNS = !!user.freeGuns;
// ?debug in the page URL: T shows hit boxes and coordinates (for testing; players never see them).
export const DEBUG = params.has('debug');
