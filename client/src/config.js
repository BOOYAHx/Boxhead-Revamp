// Resolved server addresses: window.BOXHEAD_CONFIG (config.js), then
// ?bridge=...&api=... in the page URL, then defaults next to the page host.

const user = window.BOXHEAD_CONFIG || {};
const params = new URLSearchParams(location.search);
const secure = location.protocol === 'https:';
const host = location.hostname || '127.0.0.1';

export const BRIDGE_URL = params.get('bridge') || user.bridgeUrl || `${secure ? 'wss' : 'ws'}://${host}:8081/`;
export const API_URL = params.get('api') || user.apiUrl || `${secure ? 'https' : 'http'}://${host}:8081/api/`;
