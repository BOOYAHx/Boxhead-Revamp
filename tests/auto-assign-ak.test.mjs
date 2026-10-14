// Options → Auto Assign AK-47: buying the AK-47 puts the Weapon Bank 1 key on the
// AK-47's bank (and that bank's key on bank 1) until the game ends.
import assert from 'node:assert/strict';
import test from 'node:test';

globalThis.Phaser = { Scene: class {} };
globalThis.window = { BOXHEAD_CONFIG: {} };
globalThis.document = { getElementById() {} };
globalThis.location = { search: '', hostname: 'localhost', protocol: 'http:' };
const { GameScene } = await import('../client/src/scenes/GameScene.js');
const { Character } = await import('../client/src/game/Character.js');
const { bankForKey, getBind } = await import('../client/src/game/controls.js');
const { Preferences } = await import('../client/src/game/preferences.js');
const { Weapon, WeaponID, defaultBanks, parseWeaponStats, setBankLayout, setWeaponStats } = await import('../client/src/game/weapons.js');

const constants = `<data>
  <weapon id="0"><ammo>Infinite</ammo><fireDelay>0.5</fireDelay></weapon>
  <weapon id="2"><ammo>250</ammo><ammoIncrement>250</ammoIncrement><fireDelay>0.15</fireDelay></weapon>
  <weapon id="13"><ammo>100</ammo><ammoIncrement>100</ammoIncrement><fireDelay>0.15</fireDelay></weapon>
  <weapon id="15"><ammo>20</ammo><ammoIncrement>20</ammoIncrement><fireDelay>1.5</fireDelay></weapon>
</data>`;

/** A local player in offline practice with Dual Uzis (bank 1) and the Rifle (bank 2); the AK-47 sits alone in bank 6. */
function setup() {
  setWeaponStats(parseWeaponStats(constants));
  defaultBanks();
  setBankLayout([[], [WeaponID.AKIMBO_UZIS], [WeaponID.RIFLE], [], [], [], [WeaponID.AK47]]);
  const scene = new GameScene();
  scene.init({ mode: 'offline', app: {} });
  const player = new Character({ id: '001', name: 'You', local: true });
  player.respawn(2, 2);
  player.move = () => {};
  for (const id of [WeaponID.AKIMBO_UZIS, WeaponID.RIFLE]) player.pickupWeapon(new Weapon(id));
  player.selectWeaponByID(WeaponID.RIFLE);
  scene.player = player;
  scene.ui = { slider: { setBanks() {}, update() {} } };
  scene.updateScores = scene.setSpy = scene.stopLoop = () => {};
  scene.effects = { playSound() {}, soundLength() { return 0; } };
  scene.playReloadSound = scene.stopReloadSounds = () => {};
  let pressed = [];
  scene.keyState = { newPress: (action) => pressed.includes(action), isDown: () => false, endTick() {} };
  const press = (action) => {
    player.selectWeaponByID(WeaponID.RIFLE); // from another bank, so the key picks the bank's first gun
    pressed = [action];
    scene.handleWeaponKeys();
    pressed = [];
    return player.weapon.id;
  };
  const buyAK = () => scene.purchased({ event: 'buy', action: '0', weapon: new Weapon(WeaponID.AK47) });
  const stubs = { ...scene };
  const newRound = () => {
    scene.init({ mode: 'offline', app: {}, newRound: true });
    for (const key of ['player', 'ui', 'effects', 'keyState']) scene[key] = stubs[key];
  };
  return { scene, player, press, buyAK, newRound };
}

test('the key swap: bank 1 and the AK-47 bank trade places, the rest stay', () => {
  assert.deepEqual([1, 2, 3, 6, 8].map((n) => bankForKey(n, 6)), [6, 2, 3, 1, 8]);
  assert.deepEqual([1, 6].map((n) => bankForKey(n, null)), [1, 6]);
  assert.deepEqual([1, 2].map((n) => bankForKey(n, 1)), [1, 2], 'the AK-47 already in bank 1: nothing to do');
});

test('ticked: after buying the AK-47 the Weapon Bank 1 key selects it, bank 6 key selects bank 1', () => {
  Preferences.autoAssignAK = true;
  const s = setup();
  assert.equal(s.press('weapon1'), WeaponID.AKIMBO_UZIS, 'before buying: bank 1 as usual');
  const saved = getBind('weapon1');
  s.buyAK();
  assert.equal(s.press('weapon1'), WeaponID.AK47);
  assert.equal(s.press('weapon6'), WeaponID.AKIMBO_UZIS);
  assert.equal(getBind('weapon1'), saved, 'the saved controls are not changed');
  // The next round (or another room) starts with the keys as they were.
  s.newRound();
  assert.equal(s.press('weapon1'), WeaponID.AKIMBO_UZIS);
  // Returning the AK-47 also puts the key back.
  s.buyAK();
  s.scene.purchased({ event: 'refund', action: '0', weapon: s.player.weaponByID(WeaponID.AK47) });
  assert.equal(s.press('weapon1'), WeaponID.AKIMBO_UZIS);
});

test('unticked: buying the AK-47 changes nothing', () => {
  Preferences.autoAssignAK = false;
  const s = setup();
  s.buyAK();
  assert.equal(s.press('weapon1'), WeaponID.AKIMBO_UZIS);
  assert.equal(s.press('weapon6'), WeaponID.AK47);
});
