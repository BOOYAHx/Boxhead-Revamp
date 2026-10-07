// Map data bundled with the client.
//
// Maps normally come from the bounty map list (xgen.stickarena.maps.list for
// BBHBOUNTYMAPS), fetched through BBHServer.py's /api/ gateway exactly like the
// Flash client. The Warehouse obstacle layout below comes from the patched
// SWF (boxhead.world.WarehouseRepair) and doubles as an offline fallback map
// when the map service cannot be reached.

/** Warehouse obstacles as published (one wall piece is misplaced). */
export const WAREHOUSE_ORIGINAL =
  'fd47f21f2f28fdfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfdfbfbfbfbfbfbfbfbfbfbfbfb' +
  'fbfbf2f2f2f2f2f2f2f2f2f2f2f2f8f9fc2a5a5a51a4a4a41u2fcc2c2c24c1c1c1c12c11c2c12fcc1c1c11c11c1c11c12fc5' +
  'c2c2c2s14f6fc2a5a5a5s1a4a4a42fc2c25c15s1b63fcc1c1c12c1c11c13fc5c2c27fc28c25c19a3a3a312fc34c19a3a3a31' +
  '2fc17c2c28c12c1fcc226fc3a3a3a311c14fc5c1c1c1fcc23c13c1c117fc3a3a3a35fc3c2c25fc5c22fc1c12c15c11fcu34c' +
  '17f6fc11fc8c11fc1c13c22fc12fc4c1c17f6fc11fc9c1fcc17fc6c2s14fc4c1c17f6fca9a93a1a1a13fc2s17fcc17fc5c2c' +
  '25fcf2f2f2f2f2f2f2f23f2f8f3fca9a93a1a1a13fc5c2c23fcc1c16fcc13c2c2c25fc13f4fca9a91a2a2a25fcfbfb2fbfbf' +
  'bfbfbfbfbfbfbfb5fcc13fbfbfbfbfbfb2fc13f4fc3a2a2a25fc8c1c1c11u311fc7fc13f4fc11fcc2c27c1c16c16fc7fc3t9' +
  '9f4fc9ubs1fcc2c22c1c13c1s15c17fc7fc3t7t71t2t23t2t2f4fc11fcc23c215c2c22fc1c2c21c22fc6t2t23t2t2f4fc11f' +
  'cc211c1c19s1fc4c22fc13f4fcfbfbfbfb3fbfbfbfbfcc212c29u1fc4c22fc13f4f411fcc21c23c11c1c19c17c1c23fc13f4' +
  'f411fcc2c2c23c1c1c1c16c1c1c1c112fc2t2t22r16f4f411fcc2c21c12c1c11c15c1c1c1c1c1c1c110fcs11t2t28t9f4f41' +
  '1fcfbfbfbfbfbfbfbfbfbfbfbfb2fbfbfbfbfbfbfbfbfbfbfbfbfbfb2fbfbfc13f4f42t95t96t8t8s14c1c114ul3u37t77f4' +
  'f415t8t86c111r215t94r11f4f414t95t98t96t98t912f4f42s127t72s124f4f458f4f442t715f4f42t95t95t712r23t4t41' +
  '0t7t710t2t21f4f49r23t71t78t76t4t4t714c21c24t2t21f4f418t95t7t76t77t4t46c2c18f4f423t716t4t416f4f412t8t' +
  '844f4f412t8t844f4f1f8f8f2f23f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2' +
  'f2f2f2f2f2f2f2f2f2f2f2f2f2f2f8f3';

/** Warehouse obstacles as repaired by the patched client. */
export const WAREHOUSE_FIXED =
  'fd47f21f2f28fdfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfbfdfbfbfbfbfbfbfbfbfbfbfbfb' +
  'fbfbf2f2f2f2f2f2f2f2f2f2f2f2f8f9fc2a5a5a51a4a4a41u2fcc2c2c24c1c1c1c12c11c2c12fcc1c1c11c11c1c11c12fc5' +
  'c2c2c2s14f6fc2a5a5a5s1a4a4a42fc2c25c15s14fcc1c1c12c1c11c13fc5c2c27fc28c25c19a3a3a312fc34c19a3a3a312f' +
  'c17c2c28c12c1fcc226fc3a3a3a311c14fc5c1c1c1fcc23c13c1c117fc3a3a3a35fc3c2c25fc5c22fc1c12c15c11fcu34c17' +
  'f6fc11fc8c11fc1c13c22fc12fc4c1c17f6fc11fc9c1fcc17fc6c2s14fc4c1c17f6fca9a93a1a1a13fc2s17fcc17fc5c2c25' +
  'fcf2f2f2f2f2f2f2f23f2f8f3fca9a93a1a1a13fc5c2c23fcc1c16fcc13c2c2c25fc13f4fca9a91a2a2a25fcfbfb2fbfbfbf' +
  'bfbfbfbfbfbfb5fcc13fbfbfbfbfbfb2fc13f4fc3a2a2a25fc8c1c1c11u311fc7fc13f4fc11fcc2c27c1c16c16fc7fc3t99f' +
  '4fc9ubs1fcc2c22c1c13c1s15c17fc7fc3t7t71t2t23t2t2f4fc11fcc23c215c2c22fc1c2c21c22fc6t2t23t2t2f4fc11fcc' +
  '211c1c19s1fc4c22fc13f4fcfbfbfbfb3fbfbfbfbfcc212c29u1fc4c22fc13f4f411fcc21c23c11c1c19c17c1c23fc13f4f4' +
  '11fcc2c2c23c1c1c1c16c1c1c1c112fc2t2t22r16f4f411fcc2c21c12c1c11c15c1c1c1c1c1c1c110fcs11t2t28t9f4f411f' +
  'cfbfbfbfbfbfbfbfbfbfbfbfb2fbfbfbfbfbfbfbfbfbfbfbfbfbfb2fbfbfc13f4f42t95t96t8t8s14c1c114ul3u37t77f4f4' +
  '15t8t86c111r215t94r11f4f414t95t98t96t98t912f4f42s127t72s124f4f458f4f442t715f4f42t95t95t712r23t4t410t' +
  '7t710t2t21f4f49r23t71t78t76t4t4t714c21c24t2t21f4f418t95t7t76t77t4t46c2c18f4f423t716t4t416f4f412t8t84' +
  '4f4f412t8t844f4f1f8f8f2f23f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2f2' +
  'f2f2f2f2f2f2f2f2f2f2f2f2f2f8f3';

/**
 * Offline stand-in: the real Warehouse layout on a plain tiled floor. Its
 * terrain is a guess because only the obstacle layer ships inside the SWF.
 */
export const FALLBACK_MAPS = [{ slot: 0, name: 'Warehouse (offline)', data: '160;37;' + WAREHOUSE_FIXED + ';d9d2c71e;;1' }];
