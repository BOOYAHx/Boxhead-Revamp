// Values copied from the original client's Constants / Thing / Character classes.

export const WINDOW_WIDTH = 700;
export const WINDOW_HEIGHT = 490;
export const PROCESS_INTERVAL = 50; // ms per game tick
export const SECOND = 1000 / PROCESS_INTERVAL; // ticks per second
export const POSITION_RESOLUTION = 100; // positions are sent as cells * 100
export const CELL_WIDTH = 40; // pixels
export const CELL_HEIGHT = 28; // pixels
export const SHADOW_ALPHA = 0.55;
export const RELIEF_ALPHA = 0.5;
export const MAX_STORED_POSITIONS = 2000 / PROCESS_INTERVAL;
export const PING_CYCLE_INTERVAL = 1000;
export const PING_INTERVAL = 10000;

export const CHARACTER_HEIGHT = 35;
export const MOVE_RADIUS = 0.42; // collision circle, cells
export const FIRE_RADIUS = 0.55; // bullet hit circle, cells
export const MAX_SPEED = 4 / SECOND; // cells per tick
export const RESPAWN_TIME = 5000;
export const BARREL_ALTITUDE = 18;

export const ROUND_START_TIME = 620;
export const ROUND_END_TIME = 30;

export const MONSTER = 'Monster';
export const MALE = 'Male';
export const FEMALE = 'Female';
