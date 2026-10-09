// The original's console (boxhead.ui.Console): the ` key opens it over
// everything, menus or game. It logs chat and kill messages, takes a few
// commands (ping, flood, exit / quit) and shows a graph of the last pings with
// their average ("148ms") in the corner. While it is open the game gets no keys
// (Input.pause / Game.captureInput).

import { ServerEvent } from '../net/Connection.js';
import { runModeratorCommand } from '../game/moderation.js';
import { Stage } from './flash.js';

const MAX_MESSAGES_IN = 20; // typed lines kept for Up / Down
const MAX_MESSAGES_OUT = 200; // printed lines kept
const CONSOLE_KEY = 192; // Input: keys[CONSOLE_KEY] = TILDE (` on most keyboards)
const SVGNS = 'http://www.w3.org/2000/svg';

const messagesIn = [];
const messagesOut = [];
let display = null;

/** Console.print: add a line (kept even while the console is closed). */
export function print(text) {
  if (!text) return;
  messagesOut.push(String(text));
  while (messagesOut.length > MAX_MESSAGES_OUT) messagesOut.shift();
  display?.refresh();
}

const isConsoleKey = (event) => event.keyCode === CONSOLE_KEY || event.code === 'Backquote';

export class GameConsole {
  /**
   * container: the element the console's layer goes in (over the game and menus).
   * connection: for the ping graph and the ping command. handlers.command(name, args)
   * gets every typed command (Game.consoleInput: exit / quit); handlers.opened()
   * lets the game drop the keys it holds.
   */
  constructor(container, lib, connection, handlers = {}) {
    this.connection = connection;
    this.handlers = handlers;
    this.root = document.createElement('div');
    this.root.id = 'console-ui';
    this.root.hidden = true;
    container.appendChild(this.root);
    const frame = document.createElement('div');
    frame.className = 'flash-stage';
    this.root.appendChild(frame);
    this.stage = new Stage(frame);
    const clip = (this.clip = lib.create('boxhead.ui.Console'));
    this.stage.addChild(clip);
    this.outField = clip.child('outField');
    this.inField = clip.child('inField');
    this.pingField = clip.child('pingField');
    this.scrollBar = clip.child('scrollBar');
    this.inIndex = 0;
    this.setupOutput();
    this.setupInput();
    this.setupPing(clip.child('pingDisplay'));
    connection?.on(ServerEvent.PING, () => this.updatePingDisplay());

    // Main.keyUp toggles it; while it is open no key reaches the game (or anything else).
    this.onKeyDown = (event) => {
      if (isConsoleKey(event)) event.preventDefault(); // never typed: it is the console key
      if (!this.open) return;
      event.stopImmediatePropagation();
      if (event.target === this.inField.box) this.keyDown(event);
    };
    this.onKeyUp = (event) => {
      if (isConsoleKey(event)) {
        event.preventDefault();
        this.toggle();
      }
      if (this.open || isConsoleKey(event)) event.stopImmediatePropagation();
    };
    window.addEventListener('keydown', this.onKeyDown, true);
    window.addEventListener('keyup', this.onKeyUp, true);
    display = this;
  }

  get open() {
    return !this.root.hidden;
  }

  toggle() {
    if (this.open) this.hide();
    else this.show();
  }

  /** addedToStage: focus the input, show the latest lines and pings, pause the game's keys. */
  show() {
    this.root.hidden = false;
    this.handlers.opened?.();
    this.refresh();
    this.updatePingDisplay();
    this.regainFocus();
  }

  hide() {
    this.root.hidden = true;
    this.inField.box.blur();
  }

  setupOutput() {
    const field = this.outField;
    const box = field.box;
    box.textContent = '';
    Object.assign(box.style, { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', overflow: 'hidden', pointerEvents: 'auto', userSelect: 'text' });
    const line = field.lineHeight;
    box.addEventListener('scroll', () => this.updateBar());
    box.addEventListener('wheel', (event) => {
      box.scrollTop += event.deltaY > 0 ? line : -line;
      event.preventDefault();
    });
    const bar = this.scrollBar;
    bar?.on('scrolldrag', (e) => {
      box.scrollTop = Math.round((e.detail * (box.scrollHeight - box.clientHeight)) / line) * line;
      this.regainFocus();
    });
    bar?.on('stepup', () => ((box.scrollTop -= line), this.regainFocus()));
    bar?.on('stepdown', () => ((box.scrollTop += line), this.regainFocus()));
  }

  setupInput() {
    this.inField.text = '';
    this.inField.box.maxLength = 200;
    this.inField.box.spellcheck = false;
    this.inField.box.autocomplete = 'off';
  }

  /** The ping graph: the last pings as a line, yellow when low and red from 100 ms up. */
  setupPing(holder) {
    this.pingLine = null;
    if (!holder) return;
    const id = 'consolePing' + Math.random().toString(36).slice(2);
    const gradient = document.createElementNS(SVGNS, 'linearGradient');
    gradient.id = id;
    for (const [name, value] of Object.entries({ gradientUnits: 'userSpaceOnUse', x1: 0, y1: -10, x2: 0, y2: 0 })) gradient.setAttribute(name, value);
    for (const [offset, color] of [[0, '#ff0000'], [1, '#ffff00']]) {
      const stop = document.createElementNS(SVGNS, 'stop');
      stop.setAttribute('offset', offset);
      stop.setAttribute('stop-color', color);
      gradient.appendChild(stop);
    }
    const line = (this.pingLine = document.createElementNS(SVGNS, 'polyline'));
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', `url(#${id})`);
    line.setAttribute('stroke-width', 2);
    line.setAttribute('stroke-linejoin', 'round');
    line.setAttribute('stroke-linecap', 'round');
    holder.el.append(gradient, line);
  }

  /** Console.updatePingDisplay */
  updatePingDisplay() {
    if (!this.open) return;
    const c = this.connection;
    const times = c?.connected ? c.pingTimes.slice(-5) : [];
    if (!times.length) {
      this.pingLine?.setAttribute('points', '');
      this.pingField.text = '';
      return;
    }
    const points = times.map((t, i) => `${-50 + i * 12.5},${-Math.min(t, 1000) / 10}`);
    this.pingLine?.setAttribute('points', points.join(' '));
    this.pingField.text = Math.trunc(times.reduce((a, b) => a + b, 0) / times.length) + 'ms';
  }

  /** Console.refresh: every printed line; follow the newest when already at the bottom. */
  refresh() {
    if (!this.open) return;
    const box = this.outField.box;
    const atBottom = box.scrollTop >= box.scrollHeight - box.clientHeight - 2;
    box.textContent = messagesOut.join('\n');
    if (atBottom) box.scrollTop = box.scrollHeight;
    this.updateBar();
  }

  updateBar() {
    const box = this.outField.box;
    const range = box.scrollHeight - box.clientHeight;
    if (!this.scrollBar) return;
    this.scrollBar.handleSize = range > 0 ? box.clientHeight / box.scrollHeight : 1;
    this.scrollBar.scrollValue = range > 0 ? box.scrollTop / range : 0;
  }

  regainFocus() {
    const box = this.inField.box;
    box.focus({ preventScroll: true });
    box.setSelectionRange(box.value.length, box.value.length);
  }

  /** Console.keyDown: Enter runs the line; Up / Down go through the earlier ones. */
  keyDown(event) {
    if (event.key === 'Enter') {
      const text = this.inField.text;
      this.inField.text = '';
      if (text && text !== '/') this.processInput(text);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.inIndex = Math.max(0, this.inIndex - 1);
      this.showInIndex();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.inIndex = Math.min(messagesIn.length, this.inIndex + 1);
      this.showInIndex();
    } else if (event.key === 'Tab') {
      event.preventDefault();
    }
  }

  showInIndex() {
    this.inField.text = this.inIndex >= messagesIn.length ? '' : messagesIn[this.inIndex];
    this.regainFocus();
  }

  /** Console.processInput */
  processInput(text) {
    messagesIn.push(text);
    while (messagesIn.length > MAX_MESSAGES_IN) messagesIn.shift();
    this.inIndex = messagesIn.length;
    if (runModeratorCommand(this.connection, text.startsWith('/') ? text : '/' + text, print)) return;
    if (text.charAt(0) === '/') text = text.slice(1);
    const args = text.toLowerCase().split(' ');
    const command = args.shift();
    if (command === 'ping') {
      const c = this.connection;
      print(c?.connected ? 'Ping: ' + Math.round(c.ping) : 'Not Connected');
    } else if (command === 'flood') {
      for (let n = parseInt(args[0], 10) || 20; n > 0; n--) print('flood');
    }
    if (command) this.handlers.command?.(command, args);
  }
}
