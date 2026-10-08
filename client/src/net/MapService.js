// The bounty map list and map data, fetched like DatabaseRequest did:
// xgen.stickarena.maps.list / maps.get for the BBHBOUNTYMAPS account, here
// through BBHServer.py's /api/ gateway. The maps saved into the game files by
// tools/save_maps.py come first, so play does not depend on the service; the
// bundled Warehouse is the last resort.

import { API_URL } from '../config.js';
import { ASSET_ROOT } from '../render/assets.js';
import { FALLBACK_MAPS } from '../game/maps.js';

const ACCOUNT = 'BBHBOUNTYMAPS';

async function request(params, signal) {
  const url = API_URL + '?' + new URLSearchParams({ username: ACCOUNT, ...params });
  const response = await fetch(url, { cache: 'no-store', signal });
  if (!response.ok) throw new Error(`${params.method}: HTTP ${response.status}`);
  const xml = new DOMParser().parseFromString(await response.text(), 'application/xml');
  const rsp = xml.documentElement;
  if (!rsp || rsp.nodeName !== 'rsp' || rsp.getAttribute('stat') !== 'ok') throw new Error(`${params.method}: bad response`);
  return rsp;
}

/** The maps saved by tools/save_maps.py (maps/maps.json: [{ slot, name, data }]), or null. */
async function savedMapList() {
  try {
    const response = await fetch(ASSET_ROOT + 'maps/maps.json', { cache: 'no-store' });
    if (!response.ok) return null;
    const list = [];
    for (const map of await response.json()) {
      if (map && map.slot >= 0 && typeof map.data === 'string') list[map.slot] = { slot: map.slot, name: map.name || `Map ${map.slot}`, data: map.data, online: false, saved: true };
    }
    return list.some(Boolean) ? list : null;
  } catch {
    return null;
  }
}

/** Map list indexed by slot id (MapInfo.mapList): [{ slot, name }]. */
export async function fetchMapList() {
  const saved = await savedMapList();
  if (saved) return saved;
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
export async function fetchMap(info, signal) {
  if (!info.online) return info.data;
  const rsp = await request({ method: 'xgen.stickarena.maps.get', slot_id: String(info.slot) }, signal);
  const data = rsp.querySelector('maps > map > data')?.textContent;
  if (!data) throw new Error('map has no data');
  return data.trim();
}
