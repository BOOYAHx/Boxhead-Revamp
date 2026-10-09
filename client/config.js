// Server addresses. Leave a value as null to use the default shown.
// This file is not a module so it can be edited on the web server directly.
window.BOXHEAD_CONFIG = {
  // WebSocket bridge (BBHServer.py). Default: ws://<this page's host>:8081/
  // (wss:// when the page is served over https).
  bridgeUrl: null,
  // Map service gateway (BBHServer.py /api/). Default: http(s)://<host>:8081/api/
  apiUrl: null,
  // Most Wanted rankings. Default: the apiUrl folder + assets/mostwanted.xml
  mostWantedUrl: null,
  // Server name shown in the menus. Default: Squaresville
  serverName: null,
  // false: guns, ammo and upgrades use their normal shop prices.
  // (Each player's page decides, so set it here on the website for everyone.)
  freeGuns: false,
};
