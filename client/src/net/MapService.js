// The bounty map list and map data, fetched like DatabaseRequest did:
// xgen.stickarena.maps.list / maps.get for the BBHBOUNTYMAPS account, here
// through BBHServer.py's /api/ gateway. Falls back to the bundled map when
// the service cannot be reached.

import { API_URL } from '../config.js';
import { FALLBACK_MAPS } from '../game/maps.js';

const ACCOUNT = 'BBHBOUNTYMAPS';

async function request(params) {
  const url = API_URL + '?' + new URLSearchParams({ username: ACCOUNT, ...params });
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${params.method}: HTTP ${response.status}`);
  const xml = new DOMParser().parseFromString(await response.text(), 'application/xml');
  const rsp = xml.documentElement;
  if (!rsp || rsp.nodeName !== 'rsp' || rsp.getAttribute('stat') !== 'ok') throw new Error(`${params.method}: bad response`);
  return rsp;
}

/** Map list indexed by slot id (MapInfo.mapList): [{ slot, name }]. */
export async function fetchMapList() {
  try {
    const rsp = await request({ method: 'xgen.stickarena.maps.list' });
    const list = [];
    for (const node of rsp.querySelectorAll('maps > map')) {
      const slot = parseInt(node.getAttribute('slot_id'), 10);
      if (slot >= 0) list[slot] = { slot, name: node.querySelector('name')?.textContent || `Map ${slot}`, online: true };
    }
    if (list.some(Boolean)) return list;
    throw new Error('empty map list');
  } catch (error) {
    console.warn('Map service unavailable, using the bundled map:', error.message);
    return FALLBACK_MAPS.map((map) => ({ ...map, online: false }));
  }
}

/** Map string for one slot. */
export async function fetchMap(info) {
  if (!info.online) return info.data;
  const rsp = await request({ method: 'xgen.stickarena.maps.get', slot_id: String(info.slot) });
  const data = rsp.querySelector('maps > map > data')?.textContent;
  if (!data) throw new Error('map has no data');
  return data.trim();
}
