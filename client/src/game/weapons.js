// Weapons: the stats in constants.xml and the rules of boxhead.world.weapon.*
// (WeaponInfo, Weapon, Weapon1h/2h, WeaponAkimbo, Shotgun, Minigun, Flamer,
// Magnum, Railgun, ...), plus Ammo and WeaponUpgrade. Pure logic (no Phaser)
// so the timings can be unit-tested; the scene shows the effects reported.

import { DIRECTIONS } from './Direction.js';
import { SECOND } from './constants.js';

export const WeaponID = {
  PISTOL: 0,
  AKIMBO_PISTOLS: 1,
  AKIMBO_UZIS: 2,
  SHOTGUN: 3,
  MINIGUN: 4,
  FLAMER: 5,
  GRENADES: 6,
  BARRELS: 7,
  BARRICADES: 8,
  TURRET_MG: 9,
  TURRET_MORTAR: 10,
  MAGNUM: 11,
  SPY: 12,
  AK47: 13,
  M16: 14,
  RIFLE: 15,
  RAILGUN: 16,
  C4: 17,
  AIRSTRIKE: 18,
  MINES: 19,
  GRENADE_LAUNCHER: 20,
  PLASMA: 21,
};
export const PISTOL_ID = WeaponID.PISTOL;
export const NUM_WEAPONS = 22;
export const NUM_BANKS = 8;

export const Pose = { UNARMED: 0, ONE_HAND: 1, TWO_HAND: 2, AKIMBO: 3 }; // Weapon.animID
const DEFAULT_RANGE = 100; // WeaponInfo.create: range || 100
const FLAMER_DAMAGE = 3; // XMLConstants forces it

// --- muzzle flash offsets (Weapon.getMuzzleOffsets), pixels per weapon frame -------------------
// Index = weapon frame (9 per direction, directions in sheet order S, SW, W, NW, N, NE, E, SE).

const table = (text) => text.split(';').map((pair) => pair.split(',').map(Number));
const MUZZLE = {
  Pistol: table('-10,-5;-10,-4;-10,-4;-10,-4;-10,-5;-10,-5;-10,-5;-10,-4;-10,-4;-24,-15;-25,-15;-25,-14;-24,-14;-24,-15;-24,-15;-24,-15;-24,-14;-25,-14;-24,-29;-25,-30;-25,-29;-25,-29;-24,-29;-24,-30;-24,-29;-25,-29;-25,-29;-10,-39;-11,-40;-10,-40;-10,-40;-10,-39;-10,-39;-10,-39;-10,-40;-10,-40;10,-39;11,-40;11,-40;11,-40;11,-39;11,-40;11,-39;11,-40;11,-40;25,-29;26,-30;26,-30;25,-29;25,-29;25,-30;25,-29;25,-29;26,-30;24,-15;26,-15;26,-15;25,-14;25,-15;25,-15;25,-15;25,-15;26,-15;10,-5;11,-4;11,-4;11,-4;11,-5;10,-5;11,-5;11,-4;11,-4'),
  AkimboPistols: [
    table('10,-5;10,-5;11,-5;10,-4;10,-4;10,-4;10,-4;10,-4;10,-5;-10,-5;-10,-5;-10,-5;-10,-4;-11,-4;-11,-4;-11,-4;-10,-4;-10,-5;-24,-15;-24,-15;-24,-15;-25,-15;-25,-15;-25,-15;-25,-15;-25,-15;-24,-15;-24,-29;-24,-30;-24,-29;-24,-29;-25,-30;-25,-30;-25,-30;-24,-29;-24,-30;-10,-39;-10,-40;-10,-39;-9,-40;-9,-40;-10,-40;-10,-40;-9,-40;-9,-40;10,-39;11,-39;11,-39;11,-39;11,-40;11,-40;11,-40;11,-39;11,-39;24,-29;25,-30;25,-29;26,-29;26,-29;26,-30;26,-29;26,-29;25,-29;25,-15;25,-15;25,-15;25,-14;25,-14;26,-15;26,-14;25,-14;25,-15'),
    // The original has [-75, -75] at NW walk frame 5 (a typo); kept.
    table('-11,-6;-11,-5;-11,-5;-11,-5;-11,-6;-11,-6;-11,-6;-11,-5;-11,-5;-25,-16;-26,-16;-26,-15;-25,-15;-25,-16;-25,-16;-25,-16;-25,-15;-26,-15;-25,-30;-26,-31;-26,-30;-26,-30;-25,-30;-25,-31;-25,-30;-26,-30;-26,-30;-11,-40;-12,-41;-11,-41;-11,-41;-11,-40;-75,-75;-11,-40;-11,-41;-11,-41;9,-40;10,-41;10,-41;10,-41;10,-40;10,-41;10,-40;10,-41;10,-41;24,-30;25,-31;25,-31;24,-30;24,-30;24,-31;24,-30;24,-30;25,-31;23,-16;25,-16;25,-16;24,-15;24,-16;24,-16;24,-16;24,-16;25,-16;9,-6;10,-5;10,-5;10,-5;10,-6;9,-6;10,-6;10,-5;10,-5'),
  ],
  AkimboUzis: [
    table('10,-4;11,-4;11,-4;10,-3;10,-3;10,-3;10,-3;10,-3;10,-4;-10,-4;-10,-5;-11,-4;-11,-4;-12,-4;-12,-4;-11,-4;-11,-4;-11,-4;-25,-15;-25,-15;-25,-15;-26,-15;-26,-15;-26,-15;-26,-15;-26,-15;-25,-15;-25,-29;-25,-30;-25,-30;-25,-30;-25,-31;-26,-31;-26,-30;-25,-30;-25,-30;-10,-40;-10,-40;-10,-40;-10,-40;-9,-41;-10,-41;-10,-41;-10,-40;-9,-40;11,-40;11,-40;11,-40;12,-40;12,-40;12,-41;12,-40;12,-40;12,-40;26,-29;26,-30;26,-29;27,-29;27,-29;27,-29;27,-29;27,-29;26,-29;25,-14;26,-15;26,-14;26,-14;26,-14;26,-14;26,-14;26,-14;26,-14'),
    table('-11,-5;-11,-4;-11,-4;-11,-4;-11,-5;-11,-5;-11,-5;-11,-4;-11,-4;-26,-15;-27,-15;-27,-15;-26,-15;-26,-15;-26,-16;-26,-15;-26,-15;-27,-15;-26,-30;-27,-30;-27,-30;-27,-30;-26,-30;-26,-31;-26,-30;-27,-30;-27,-30;-11,-41;-12,-42;-12,-41;-12,-41;-12,-41;-11,-41;-12,-41;-12,-41;-12,-41;10,-41;9,-42;10,-42;10,-41;10,-41;9,-41;10,-41;10,-41;10,-42;24,-30;26,-32;25,-31;25,-31;25,-31;24,-31;25,-31;25,-31;25,-31;25,-16;26,-16;26,-16;26,-15;25,-16;25,-16;25,-16;26,-16;26,-16;10,-5;11,-5;11,-5;11,-5;10,-5;10,-6;10,-5;11,-5;11,-5'),
  ],
  Shotgun: table('-11,0;-11,0;-11,0;-11,0;-11,-1;-11,-1;-11,0;-11,0;-11,0;-27,-11;-28,-10;-27,-10;-27,-11;-26,-11;-26,-11;-26,-11;-27,-10;-27,-11;-27,-27;-28,-27;-28,-26;-27,-26;-27,-26;-26,-26;-27,-26;-27,-26;-28,-26;-12,-38;-13,-38;-12,-38;-12,-37;-12,-37;-12,-37;-12,-37;-12,-37;-12,-37;10,-38;10,-39;10,-38;10,-37;10,-37;9,-37;10,-37;10,-37;10,-38;26,-27;26,-27;26,-27;26,-27;25,-27;25,-27;25,-27;26,-26;26,-27;26,-12;27,-12;27,-11;26,-11;25,-12;25,-12;25,-11;26,-11;26,-11;11,0;11,0;11,0;11,0;10,-1;10,-1;11,-1;11,0;11,0'),
  Minigun: table('-10,0;-10,1;-10,1;-10,0;-10,0;-10,-1;-10,0;-10,1;-10,1;-26,-11;-27,-10;-27,-10;-26,-11;-26,-11;-25,-11;-25,-11;-26,-10;-26,-10;-27,-27;-28,-26;-27,-26;-27,-26;-26,-26;-26,-26;-26,-26;-27,-26;-27,-26;-11,-38;-12,-38;-12,-38;-11,-37;-11,-37;-11,-37;-11,-37;-11,-37;-12,-38;11,-38;11,-39;11,-38;11,-38;11,-38;11,-38;11,-38;11,-38;11,-38;27,-27;28,-28;27,-27;27,-27;26,-27;26,-27;26,-27;27,-27;27,-27;28,-12;29,-12;28,-11;27,-11;27,-12;26,-12;27,-12;27,-11;28,-12;12,0;13,0;13,0;12,0;12,-1;12,-1;12,-1;12,0;12,0'),
  Flamer: table('-10,6;-10,7;-10,7;-10,7;-10,6;-9,6;-9,6;-10,7;-10,7;-30,-6;-31,-5;-31,-5;-31,-5;-30,-6;-29,-6;-30,-5;-30,-5;-31,-5;-33,-25;-34,-25;-34,-24;-33,-24;-32,-24;-32,-24;-32,-24;-33,-24;-33,-24;-16,-39;-17,-39;-16,-39;-16,-39;-16,-38;-16,-38;-16,-38;-16,-38;-16,-39;11,-41;11,-42;11,-41;11,-40;10,-40;10,-40;10,-40;10,-40;11,-41;31,-29;32,-29;32,-29;31,-28;31,-28;30,-29;31,-28;31,-28;32,-29;34,-10;35,-10;34,-10;34,-10;33,-10;33,-11;33,-10;34,-9;34,-10;17,5;17,5;17,5;17,5;17,4;16,4;17,4;17,5;17,5'),
  Magnum: table('-10,4;-10,5;-10,5;-10,5;-10,4;-10,4;-10,4;-10,5;-10,5;-35,-9;-36,-8;-36,-8;-35,-8;-35,-9;-35,-9;-35,-9;-35,-8;-36,-8;-39,-31;-41,-31;-40,-31;-40,-31;-39,-31;-39,-31;-39,-31;-40,-31;-40,-31;-20,-48;-21,-49;-21,-49;-21,-49;-20,-49;-20,-49;-20,-49;-21,-49;-21,-49;11,-51;10,-53;11,-52;11,-52;11,-52;11,-52;11,-52;11,-52;11,-52;35,-38;36,-39;36,-39;36,-38;36,-39;36,-39;36,-39;36,-38;36,-39;40,-16;41,-17;41,-16;41,-16;40,-16;40,-17;40,-16;41,-16;41,-16;21,1;22,2;22,2;21,2;21,1;21,1;21,1;21,2;22,2'),
  AK47: table('-10,6;-10,6;-10,6;-10,6;-10,5;-9,5;-9,5;-10,6;-10,6;-30,-6;-31,-6;-30,-6;-30,-6;-29,-6;-29,-7;-29,-6;-30,-6;-30,-6;-32,-25;-33,-25;-33,-24;-32,-24;-31,-24;-31,-24;-32,-24;-32,-24;-33,-24;-15,-39;-16,-39;-16,-39;-15,-38;-15,-38;-15,-38;-15,-38;-15,-38;-16,-39;11,-40;11,-41;11,-41;11,-40;10,-40;10,-40;10,-40;11,-40;11,-40;31,-29;31,-29;31,-28;31,-28;30,-28;30,-28;30,-28;30,-28;31,-29;33,-10;34,-10;34,-10;33,-10;32,-10;32,-11;32,-10;33,-10;33,-10;16,4;17,5;16,5;16,4;16,4;16,3;16,4;16,4;16,5'),
  M16: table('-10,9;-10,10;-10,10;-10,9;-9,8;-9,8;-9,9;-9,9;-10,9;-33,-4;-34,-3;-34,-3;-33,-4;-33,-4;-32,-4;-32,-4;-33,-3;-33,-3;-37,-25;-38,-25;-37,-24;-37,-24;-36,-25;-36,-24;-36,-24;-37,-24;-37,-24;-19,-41;-19,-42;-19,-41;-19,-41;-19,-41;-19,-40;-19,-40;-19,-41;-19,-41;11,-44;11,-45;11,-44;11,-43;10,-43;10,-43;10,-43;10,-43;10,-44;34,-31;35,-32;34,-31;34,-31;33,-31;33,-31;33,-31;34,-31;34,-31;38,-10;39,-10;38,-10;38,-10;37,-11;37,-11;37,-11;38,-10;38,-10;20,6;20,7;20,7;20,7;19,6;19,5;19,6;20,7;20,7'),
  Rifle: table('-10,12;-10,13;-10,12;-10,12;-9,11;-9,11;-9,11;-9,12;-9,12;-36,-2;-37,-1;-36,-1;-36,-2;-35,-2;-35,-2;-35,-2;-36,-1;-36,-1;-41,-25;-42,-25;-42,-24;-41,-24;-40,-24;-40,-24;-40,-24;-41,-24;-41,-24;-22,-43;-22,-44;-22,-43;-22,-43;-21,-43;-22,-42;-22,-42;-22,-42;-22,-43;10,-47;10,-47;10,-47;10,-46;10,-46;10,-46;10,-46;10,-46;10,-47;37,-33;38,-34;37,-33;37,-33;36,-33;35,-33;36,-33;37,-33;37,-33;42,-11;43,-10;42,-10;42,-10;41,-11;41,-11;41,-11;42,-10;42,-10;23,8;23,9;23,9;23,8;22,8;22,7;22,8;23,9;23,8'),
  Railgun: table('-10,2;-10,3;-10,3;-10,3;-10,3;-10,2;-10,3;-10,3;-10,3;-32,-10;-33,-10;-33,-10;-33,-10;-33,-10;-32,-10;-33,-10;-33,-10;-33,-10;-36,-30;-37,-31;-37,-30;-37,-30;-36,-31;-36,-31;-36,-31;-37,-30;-37,-30;-18,-46;-19,-47;-19,-47;-18,-47;-18,-47;-18,-47;-18,-47;-18,-47;-19,-47;11,-49;10,-50;11,-50;11,-49;11,-49;11,-49;11,-49;11,-49;11,-50;33,-36;34,-37;34,-37;34,-36;33,-36;33,-37;33,-36;34,-36;34,-37;36,-16;38,-17;38,-16;37,-16;37,-16;37,-16;37,-16;37,-16;38,-16;19,0;20,0;20,1;19,1;19,0;19,0;19,0;19,1;20,1'),
};

// Minigun.chamberOffsets[direction][chamber]: the barrels turn, so the flash moves a little.
const CHAMBERS = [
  [[0, -2], [1, 0], [1, 0], [0, 2], [-1, 0], [-1, 0]], // S
  [[0, -2], [1, 1], [1, 1], [0, 2], [-1, -1], [-1, -1]], // SW
  [[0, -2], [0, -1], [0, 1], [0, 2], [0, 1], [0, -1]], // W
  [[0, -2], [-1, 1], [-1, 1], [0, 2], [1, -1], [1, -1]], // NW
  [[0, -2], [-1, 0], [-1, 0], [0, 2], [1, 0], [1, 0]], // N
  [[0, -2], [-1, -1], [-1, -1], [0, 2], [1, 1], [1, 1]], // NE
  [[0, -2], [0, -1], [0, 1], [0, 2], [0, 1], [0, -1]], // E
  [[0, -2], [1, -1], [1, -1], [0, 2], [-1, 1], [-1, 1]], // SE
];

// --- what each weapon is (WeaponInfo.init and the weapon classes) -----------------------------

const SMALL_FLASHES = ['MuzzleFlashSmall1', 'MuzzleFlashSmall2'];
const LARGE_FLASHES = ['MuzzleFlashLarge1', 'MuzzleFlashLarge2'];
const fireSounds = (name) => [1, 2, 3].map((i) => `${name}Fire0${i}`);

// Weapon defaults (Weapon.as) and the one-, two-handed and akimbo variants.
const BASE = {
  kind: 'gun', // gun (hitscan) | projectile | thrown | planter | gadget
  pose: Pose.UNARMED,
  barrelAltitude: 18,
  handMultiplier: 1,
  sideDistance: 0.25,
  barrelDistance: 0.8,
  smokeSize: 3,
  smokeDistance: 0.85,
  shellDistance: 0.35,
  flashTime: 2,
  loopFadeTime: 3,
  muzzleFlashes: [],
  muzzleOffsets: [],
  fireSounds: [],
  reloadSound: null,
  reloadSoundDelay: 0,
  reloadSound2: null,
  reloadSoundDelay2: 0,
  changeSound: null,
  loopSound: null,
  stopSound: null,
  tracerColor: 0xffffff,
  tracerAlpha: 0.4,
  particles: 'smokeAndShell', // smokeAndShell | shotgun | smokeTrail | fire | none
  penetrates: false,
  displays: null, // sprite names the weapon switches between (lit/unlit, spinning)
  backpack: null,
};
const ONE_HAND = { pose: Pose.ONE_HAND, barrelAltitude: 22 };
const TWO_HAND = { pose: Pose.TWO_HAND, sideDistance: 0.3 };
const AKIMBO = { pose: Pose.AKIMBO, barrelAltitude: 22, akimbo: true };
const THROWN = { kind: 'thrown', smokeDistance: 0, shellDistance: 0, barrelDistance: 0.4, sideDistance: 0, particles: 'none', flashTime: 0 };
const PLANTER = { kind: 'planter', smokeDistance: 0, shellDistance: 0, barrelDistance: 0, sideDistance: 0, particles: 'none', flashTime: 0, sprite: 'Wrench' };

export const Bank = { PISTOL: 1, TWO_HAND: 2, HEAVY: 3, GRENADE: 4, EXPLOSIVES: 5, OBSTACLE: 6, TURRET: 7, GADGET: 8 };

const INFO = {
  [WeaponID.PISTOL]: { ...ONE_HAND, bank: 1, priority: 5, sprite: 'Pistol', muzzleFlashes: SMALL_FLASHES, muzzleOffsets: MUZZLE.Pistol, fireSounds: fireSounds('Pistol'), reloadSound: 'PistolReload', reloadSoundDelay: 200, changeSound: 'ChangeWeapon1', smokeSize: 2 },
  [WeaponID.AKIMBO_PISTOLS]: { ...AKIMBO, bank: 1, priority: 4, sprite: 'AkimboPistols', muzzleFlashes: SMALL_FLASHES, muzzleOffsets: MUZZLE.AkimboPistols, fireSounds: fireSounds('Pistol'), reloadSound: 'PistolReload', reloadSound2: 'PistolReload', reloadSoundDelay2: 300, changeSound: 'ChangeWeapon1', smokeSize: 2 },
  [WeaponID.AKIMBO_UZIS]: { ...AKIMBO, bank: 1, priority: 3, sprite: 'AkimboUzis', muzzleFlashes: SMALL_FLASHES, muzzleOffsets: MUZZLE.AkimboUzis, fireSounds: fireSounds('Uzi'), reloadSound: 'UziReloadLeft', reloadSoundDelay: 100, reloadSound2: 'UziReloadRight', reloadSoundDelay2: 550, changeSound: 'ChangeWeapon1', smokeSize: 2.5 },
  [WeaponID.SHOTGUN]: { ...TWO_HAND, bank: 2, priority: 3, sprite: 'Shotgun', muzzleFlashes: LARGE_FLASHES, muzzleOffsets: MUZZLE.Shotgun, fireSounds: fireSounds('Shotgun'), reloadSound: 'ShotgunReload', changeSound: 'ChangeWeapon2', shellDistance: 0.05, particles: 'shotgun', pellets: true },
  [WeaponID.MINIGUN]: { ...TWO_HAND, bank: 3, priority: 2, barrelAltitude: 20, sprite: 'Minigun', displays: ['Minigun', 'MinigunSpin'], muzzleFlashes: LARGE_FLASHES, muzzleOffsets: MUZZLE.Minigun, loopSound: 'Minigun_Loop', stopSound: 'Minigun_Stop', changeSound: 'ChangeWeapon4', smokeSize: 4, shellDistance: 0.1, minigun: true },
  [WeaponID.FLAMER]: { ...TWO_HAND, bank: 3, priority: 3, barrelDistance: 1, sprite: 'Flamer', backpack: 'FlamerBackpack', muzzleOffsets: MUZZLE.Flamer, flashTime: 0, fireSounds: ['FlamerStart'], loopSound: 'FlamerLoop', stopSound: 'FlamerEnd', loopFadeTime: 6, changeSound: 'ChangeWeapon5', smokeDistance: 1, shellDistance: 1, particles: 'fire', flamer: true },
  [WeaponID.GRENADES]: { ...THROWN, bank: 4, priority: 2, sprite: 'Grenade', fireSounds: ['GrenadePullPin'], changeSound: 'ChangeWeapon4' },
  [WeaponID.BARRELS]: { ...PLANTER, bank: 6, priority: 1, fireSounds: ['PreDeployHeavy'], changeSound: 'ChangeWeapon6' },
  [WeaponID.BARRICADES]: { ...PLANTER, bank: 6, priority: 2, fireSounds: ['PreDeployHeavy'], changeSound: 'ChangeWeapon6' },
  [WeaponID.TURRET_MG]: { ...PLANTER, bank: 7, priority: 1, fireSounds: ['PreDeployHeavy'], changeSound: 'ChangeWeapon7' },
  [WeaponID.TURRET_MORTAR]: { ...PLANTER, bank: 7, priority: 2, fireSounds: ['PreDeployHeavy'], changeSound: 'ChangeWeapon7' },
  [WeaponID.MAGNUM]: { ...ONE_HAND, bank: 1, priority: 2, barrelDistance: 1, sprite: 'Magnum', muzzleFlashes: SMALL_FLASHES, muzzleOffsets: MUZZLE.Magnum, fireSounds: fireSounds('Magnum'), reloadSound: 'MagnumReload', changeSound: 'ChangeWeapon1', smokeSize: 2, smokeDistance: 1.05, shellDistance: 0.5 },
  [WeaponID.SPY]: { kind: 'gadget', bank: 8, priority: 1, sprite: 'PDA', particles: 'none', changeSound: 'ChangeWeapon6' },
  [WeaponID.AK47]: { ...TWO_HAND, bank: 2, priority: 2, sprite: 'AK47', muzzleFlashes: LARGE_FLASHES, muzzleOffsets: MUZZLE.AK47, fireSounds: fireSounds('AK47'), reloadSound: 'AK47Reload', reloadSoundDelay: 100, changeSound: 'ChangeWeapon2', shellDistance: 0.15 },
  [WeaponID.M16]: { ...TWO_HAND, bank: 2, priority: 1, barrelDistance: 0.9, sprite: 'M16', muzzleFlashes: LARGE_FLASHES, muzzleOffsets: MUZZLE.M16, fireSounds: fireSounds('M16'), reloadSound: 'M16Reload', changeSound: 'ChangeWeapon2', smokeDistance: 0.95, shellDistance: 0.15 },
  [WeaponID.RIFLE]: { ...TWO_HAND, bank: 2, priority: 4, barrelDistance: 1, sprite: 'Rifle', muzzleFlashes: LARGE_FLASHES, muzzleOffsets: MUZZLE.Rifle, fireSounds: fireSounds('Rifle'), reloadSound: 'RifleReload', changeSound: 'ChangeWeapon2', smokeDistance: 1.05, shellDistance: 0.2 },
  [WeaponID.RAILGUN]: { ...ONE_HAND, bank: 1, priority: 1, barrelAltitude: 23, sprite: 'RailgunLit', displays: ['Railgun', 'RailgunLit'], muzzleFlashes: ['MuzzleFlashRailgun'], muzzleOffsets: MUZZLE.Railgun, fireSounds: fireSounds('Railgun'), reloadSound: 'RailgunReload', changeSound: 'ChangeWeapon1', tracerColor: 0x7733ff, tracerAlpha: 1, particles: 'smokeTrail', penetrates: true, lights: true },
  [WeaponID.C4]: { ...PLANTER, bank: 5, priority: 3, sprite: 'ChargePackHeld', fireSounds: ['PreDeployLight'], changeSound: 'ChangeWeapon7' },
  [WeaponID.AIRSTRIKE]: { ...THROWN, bank: 5, priority: 1, sprite: 'AirstrikeBeaconHeld', barrelDistance: 0.1, sideDistance: 0.2, fireSounds: ['Airstrike'], changeSound: 'ChangeWeapon7' },
  [WeaponID.MINES]: { ...PLANTER, bank: 5, priority: 2, sprite: 'ClaymoreHeld', fireSounds: ['PreDeployLight'], changeSound: 'ChangeWeapon7' },
  [WeaponID.GRENADE_LAUNCHER]: { ...TWO_HAND, kind: 'projectile', bank: 4, priority: 1, sprite: 'GrenadeLauncher', fireSounds: fireSounds('GrenadeLauncher'), reloadSound: 'GrenadeLauncherReload', changeSound: 'ChangeWeapon3', shellDistance: 0.8, particles: 'none', flashTime: 0 },
  [WeaponID.PLASMA]: { ...TWO_HAND, kind: 'projectile', bank: 3, priority: 1, barrelDistance: 0.7, sprite: 'PlasmaCannon', displays: ['PlasmaCannon', 'PlasmaCannonLit'], fireSounds: fireSounds('PlasmaCannon'), reloadSound: 'PlasmaCannonReload', changeSound: 'ChangeWeapon3', smokeSize: 1.6, smokeDistance: 0, particles: 'none', lights: true },
};

/** Weapons this version can fire (the explosives and gadgets come later). */
export const isImplemented = (id) => !!INFO[id] && (INFO[id].kind || 'gun') === 'gun';

// --- stats (constants.xml) ---------------------------------------------------------------------

// The shipped Pistol values, for when constants.xml is missing.
const DEFAULT_STATS = {
  name: 'Pistol',
  shortName: 'Pistol',
  ammo: null,
  ammoIncrement: 0,
  damage: 7,
  range: 20,
  spread: 0.08,
  fireDelay: 0.5,
  moveSpeed: 1,
  cost: 0,
  ammoCost: 0,
  description: '',
  upgrades: [
    { type: 'damage', value: 9, cost: 2500 },
    { type: 'moveSpeed', value: 1.1, cost: 2500 },
  ],
};
let weaponStats = { [PISTOL_ID]: DEFAULT_STATS };

/**
 * Read every <weapon id="..."> block of constants.xml (XMLConstants.readWeapons).
 * Regex based so it also runs under Node for the tests. Like the original:
 * "Infinite" ammo is unlimited (null), a range of "Infinite" or 0 is 100
 * cells, and the Flamer always does 3 damage.
 */
export function parseWeaponStats(xml) {
  const stats = {};
  const text = (block, tag) => block.match(new RegExp(`<${tag}>\\s*([^<]*?)\\s*</${tag}>`))?.[1];
  const float = (block, tag, fallback) => {
    const value = parseFloat(text(block, tag));
    return Number.isFinite(value) ? value : fallback;
  };
  const int = (block, tag) => Math.trunc(float(block, tag, 0)); // AS3 int(NaN) is 0
  const attr = (attrs, name) => attrs.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
  for (const match of xml.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<weapon\s+id="(\d+)"([^>]*)>([\s\S]*?)<\/weapon>/g)) {
    const id = parseInt(match[1], 10);
    const body = match[3];
    const upgrades = [1, 2].map((n) => {
      const block = body.match(new RegExp(`<upgrade${n}>([\\s\\S]*?)</upgrade${n}>`))?.[1];
      const type = block && text(block, 'type');
      return type ? { type, value: float(block, 'value', 0), cost: int(block, 'cost') } : null;
    });
    const block = body.replace(/<upgrade\d>[\s\S]*?<\/upgrade\d>/g, '');
    const name = attr(match[2], 'name') || 'Weapon';
    stats[id] = {
      name,
      shortName: attr(match[2], 'shortName') || name,
      ammo: int(block, 'ammo') || null,
      ammoIncrement: int(block, 'ammoIncrement'),
      damage: id === WeaponID.FLAMER ? FLAMER_DAMAGE : int(block, 'damage'),
      range: float(block, 'range', 0) || DEFAULT_RANGE,
      spread: float(block, 'spread', 0),
      fireDelay: float(block, 'fireDelay', 1),
      moveSpeed: float(block, 'moveSpeed', 1),
      cost: int(block, 'cost'),
      ammoCost: int(block, 'ammoCost'),
      description: text(block, 'description') || '',
      upgrades,
    };
  }
  return stats;
}

export function setWeaponStats(stats) {
  weaponStats = { [PISTOL_ID]: DEFAULT_STATS, ...stats };
}

export const weaponStatsFor = (id) => weaponStats[id] || { ...DEFAULT_STATS, name: 'Weapon', shortName: 'Weapon' };

export function weaponName(id) {
  return weaponStatsFor(id).name;
}

// --- ammo and upgrades -------------------------------------------------------------------------

/** Ammo: starts with one purchase ("increment"); purchases add up to the maximum. */
export class Ammo {
  constructor(max, increment) {
    this.max = max;
    this.increment = increment;
    this.count = increment;
  }

  get full() {
    return this.count >= this.max;
  }

  /** Rounds one purchase adds (Ammo.buyCount). */
  get buyCount() {
    return Math.max(0, Math.min(this.increment, this.max - this.count));
  }

  add(n) {
    this.count = Math.min(this.max, this.count + n);
  }

  setCount(n) {
    this.count = Math.max(0, Math.min(this.max, n));
  }

  decrement() {
    this.count--;
  }
}

/** WeaponUpgrade.toString: what the shop says an upgrade does. */
export function upgradeDescription(type) {
  return (
    {
      ammo: 'Max. Ammo increased',
      damage: 'Damage increased',
      range: 'Range increased',
      spread: 'Improved accuracy',
      moveSpeed: 'Move speed increased',
      fireDelay: 'Rate of Fire increased',
    }[type] || 'Unknown'
  );
}

// --- the weapon --------------------------------------------------------------------------------

export class Weapon {
  /** remote: other players' weapons have unlimited ammo (PlayerCharacter.pickupRemoteWeapons). */
  constructor(id = PISTOL_ID, { remote = false } = {}) {
    const info = INFO[id] || INFO[PISTOL_ID];
    const stats = weaponStatsFor(id);
    Object.assign(this, BASE, info);
    this.id = id;
    this.name = stats.name;
    this.shortName = stats.shortName;
    this.description = stats.description;
    this.damage = stats.damage;
    this.range = stats.range;
    this.spread = stats.spread;
    this.moveSpeed = stats.moveSpeed;
    this.fireDelay = stats.fireDelay;
    this.price = { cost: stats.cost, ammoCost: stats.ammoCost };
    this.ammo = !remote && stats.ammo ? new Ammo(stats.ammo, stats.ammoIncrement) : null;
    this.upgrades = stats.upgrades.map((u) => (u ? { ...u, owned: false } : null));
    this.ammoWarningGiven = false;
    this.timeSinceFire = 999;
    this.timeSinceEffects = 999;
    this.effectsQueue = [];
    this.muzzleFlashVariant = 0;
    this.shoulder = { x: 0, y: 0 };
    this.muzzle = { x: 0, y: 0 };
    this.fireHand = 0; // akimbo: the hand that fired last
    this.flashHand = 0;
    this.spin = 0; // minigun
    this.spinSpeed = 0;
    this.chamber = 0;
    this.lightTime = 0; // railgun / plasma "lit" display
    this.display = info.sprite;
    if (id === WeaponID.PLASMA) this.display = 'PlasmaCannon';
    this.particleWait = 0; // flamer
    this.loopPlaying = false;
  }

  get fireDelay() {
    return this._fireDelay;
  }

  /** Seconds between shots; reloadTime is in whole ticks, truncated like the AS3 int. */
  set fireDelay(seconds) {
    this._fireDelay = seconds;
    this.reloadTime = Math.trunc(seconds * SECOND + 1e-9);
  }

  get bankID() {
    return this.bank;
  }

  get hasAmmo() {
    return !this.ammo || this.ammo.count > 0;
  }

  /** Can be selected (WeaponInfo.available). */
  get available() {
    return this.hasAmmo;
  }

  get isLoaded() {
    return this.timeSinceFire >= this.reloadTime;
  }

  /** Weapon.firedRecently (the weapon slider stays open while shooting). */
  get firedRecently() {
    return this.timeSinceFire < 4;
  }

  canFire() {
    return this.hasAmmo && this.isLoaded;
  }

  get flashVisible() {
    return this.muzzleFlashes.length > 0 && this.timeSinceEffects <= this.flashTime;
  }

  get muzzleFlash() {
    return this.muzzleFlashes[this.muzzleFlashVariant] || null;
  }

  /** WeaponAkimbo.handMultiplier: which side of the body the shot comes from. */
  get hand() {
    return this.akimbo && this.fireHand ? -1 : 1;
  }

  /** getMuzzleOffset: the flash position on this weapon frame. */
  muzzleOffset(weaponFrame) {
    if (this.akimbo) return this.muzzleOffsets[this.flashHand]?.[weaponFrame] || [0, 0];
    const base = this.muzzleOffsets[weaponFrame] || [0, 0];
    if (!this.minigun) return base;
    const extra = CHAMBERS[Math.floor(weaponFrame / 9)]?.[this.chamber] || [0, 0];
    return [base[0] + extra[0], base[1] + extra[1]];
  }

  /** Weapon.updatePosition: shoulder beside the fire position, muzzle ahead of it. */
  updatePosition(ch) {
    const side = DIRECTIONS[(ch.dir.index + 2) % 8];
    const sideDistance = this.sideDistance * this.hand;
    this.shoulder.x = ch.firePos.x + side.dx * sideDistance;
    this.shoulder.y = ch.firePos.y + side.dy * sideDistance;
    this.muzzle.x = this.shoulder.x + ch.dir.dx * this.barrelDistance;
    this.muzzle.y = this.shoulder.y + ch.dir.dy * this.barrelDistance;
  }

  /** Weapon.getFireAngle: facing plus random spread. */
  fireAngle(ch, random = Math.random) {
    return ch.dir.radians + (random() - 0.5) * this.spread;
  }

  /** getFireParam: sent after the angle in the shot packet. */
  fireParam(random = Math.random) {
    if (this.akimbo) return 1 - this.fireHand;
    if (this.pellets) return shotgunCode(random);
    return 0;
  }

  useFireAmmo() {
    if (this.ammo) this.ammo.decrement();
  }

  /**
   * Weapon.shoot: a shot from the shoulder at `angle`. Remote shots call this
   * too, with the angle and param the shooter sent. Returns the shot with its
   * tracers (bullet rays); weapons that are not guns yet have none.
   */
  shoot(ch, angle, param = 0, random = Math.random) {
    if (this.akimbo) this.fireHand = param ? 1 : 0;
    this.updatePosition(ch);
    this.timeSinceFire = 0;
    if (this.lights) this.lightTime = this.flashTime - 1;
    const start = { x: this.shoulder.x, y: this.shoulder.y };
    const ray = (a, range = this.range) => ({ start, angle: a, altitude: this.barrelAltitude, range });
    let tracers = [];
    if (this.kind !== 'gun') tracers = [];
    else if (this.pellets) {
      // Shotgun: five pellets, one per digit of the code, skewed clockwise.
      const digits = String(param).padStart(5, '0');
      for (let i = 0; i < 5; i++) {
        const k = (parseInt(digits.charAt(i), 10) - 4) / 8;
        tracers.push(ray(ch.dir.radians + k * this.spread, 10));
      }
    } else if (this.flamer) {
      const a = ch.dir.radians + (random() - 0.5) * this.spread;
      for (let k = -2; k <= 2; k++) tracers.push(ray(a + k * 0.25 * 0.3, this.range * 0.9 - Math.abs(k) * 0.7));
    } else {
      tracers = [ray(angle)];
    }
    return { weaponID: this.id, angle, param, start, tracers, hand: this.hand };
  }

  /**
   * Weapon.queueShotEffects: keep what the shot looked like (where each ray
   * stopped, where the muzzle was) to show on the next tick.
   */
  queueEffects(shot, distances) {
    this.effectsQueue.push({ shot, distances, muzzle: { x: this.muzzle.x, y: this.muzzle.y }, hand: shot.hand });
  }

  /**
   * One tick (Weapon.process). Returns the effects to show now (or null),
   * whether the weapon just reloaded, and whether its loop sound should stop.
   */
  process(current = true) {
    if (!current) this.effectsQueue.length = 0;
    this.timeSinceFire++;
    this.timeSinceEffects++;
    if (this.particleWait > 0) this.particleWait--;
    let effects = null;
    let stopLoop = false;
    if (this.effectsQueue.length > 0 && this.timeSinceEffects >= this.flashTime - 1) {
      effects = this.effectsQueue.shift();
      if (this.akimbo) this.flashHand = 1 - effects.shot.param;
      this.muzzleFlashVariant = Math.floor(Math.random() * Math.max(1, this.muzzleFlashes.length));
      this.timeSinceEffects = 0;
      effects.startLoop = !!this.loopSound && !this.loopPlaying;
      if (this.loopSound) this.loopPlaying = true;
    } else if (this.loopPlaying && this.timeSinceEffects >= this.loopFadeTime) {
      this.loopPlaying = false;
      stopLoop = true;
    }
    const reloaded = this.timeSinceFire === this.reloadTime;
    if (reloaded) this.reload();
    this.animate();
    return { effects, reloaded, stopLoop };
  }

  /** Weapon.reload (Minigun turns its barrels, Railgun/Plasma light up). */
  reload() {
    if (this.minigun) {
      this.spinSpeed = 1;
      this.chamber = (this.chamber + 2 + (this.chamber % 2)) % 6;
    }
    if (this.displays && this.lights) this.display = this.displays[1];
  }

  /** The held sprite: the Minigun spins after firing, the Railgun goes dark until reloaded. */
  animate() {
    if (this.minigun) {
      this.spin = (this.spin + this.spinSpeed) % 2;
      this.spinSpeed = Math.max(0, this.spinSpeed - 0.2);
      this.display = this.displays[Math.floor(this.spin)];
    }
    if (this.lights && this.lightTime > 0) {
      this.lightTime--;
      if (this.lightTime === 0) this.display = this.displays[0];
    }
  }

  /** Flamer.getParticles waits two ticks between bursts of fire. */
  takeFireBurst() {
    if (this.particleWait > 0) return false;
    this.particleWait = 2;
    return true;
  }

  /** WeaponUpgrade.buy. */
  buyUpgrade(n) {
    const u = this.upgrades[n - 1];
    if (!u || u.owned) return false;
    u.owned = true;
    switch (u.type) {
      case 'ammo':
        if (this.ammo) this.ammo.max = u.value;
        break;
      case 'damage':
        this.damage = u.value;
        break;
      case 'range':
        this.range = u.value;
        break;
      case 'spread':
        this.spread = u.value;
        break;
      case 'moveSpeed':
        this.moveSpeed = u.value;
        break;
      case 'fireDelay':
        this.fireDelay = u.value;
        break;
      default:
        break;
    }
    return true;
  }

  /** Tracer lines drawn from the muzzle (Weapon.lineFromTracer); the Flamer has none. */
  tracerLines(effects) {
    if (this.flamer || this.kind !== 'gun') return [];
    return effects.shot.tracers.map((t, i) => ({
      x: effects.muzzle.x,
      y: effects.muzzle.y,
      dx: Math.cos(t.angle),
      dy: Math.sin(t.angle),
      length: Math.max(0, effects.distances[i] - this.barrelDistance),
      altitude: this.barrelAltitude,
      color: this.tracerColor,
      alpha: this.tracerAlpha,
    }));
  }
}

/**
 * Shotgun.getFireParam: five digits picking the pellets' angles. The
 * original removes a digit by the wrong index, so only the 2 is ever taken
 * out (after the first pick); kept so peers see the same pellets.
 */
export function shotgunCode(random = Math.random) {
  let code = 0;
  const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  for (let m = 1; m <= 10000; m *= 10) {
    code += m * digits[Math.floor(random() * digits.length)];
    digits.splice(m, 1);
  }
  return code;
}

// Shop descriptions (Weapon.damageDescription and friends).
export const damageDescription = (w) => (w.id === WeaponID.FLAMER || w.damage >= 25 ? 'High' : w.damage >= 8 ? 'Medium' : 'Low');
export const rateOfFireDescription = (w) => (w.fireDelay <= 0.2 ? 'Fast' : w.fireDelay <= 1 ? 'Medium' : 'Slow');
export const maxAmmoDescription = (w) => (w.ammo ? String(w.ammo.max) : 'Unlimited');
