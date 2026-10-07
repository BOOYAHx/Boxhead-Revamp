// The in-game HUD, laid out like boxhead.ui.GUI: money top right, placing
// top centre, bounty points and round time under the money, warnings near
// the bottom, kill and chat messages bottom left above the chat input, an
// arrow to the leader (CharacterPointer), the Tab scoreboard and the round
// summary (GameSummary).

import { CELL_HEIGHT, CELL_WIDTH, WINDOW_HEIGHT, WINDOW_WIDTH } from '../game/constants.js';
import { placingString } from '../game/bounty.js';

const DEPTH = 10001;
const FONT = 'Verdana, sans-serif';
const SHADOW = { offsetX: 1, offsetY: 1, color: '#000000', blur: 2, fill: true };
const LOCAL_COLOR = '#d8c8c8'; // HudMessage.LOCAL_COLOR
const REMOTE_COLOR = '#c0c0c0'; // HudMessage.REMOTE_COLOR
const CHAT_COLOR = '#ffffff'; // HudMessage.CHAT_COLOR
const BOUNTY_COLOR = '#f0cb25';
const MAX_MESSAGES = 6;
const MESSAGE_HEIGHT = 16;
const FLOATER_SPEED = 600; // px per second (ScoreFloater.SPEED)
const EDGE_BUFFER = 0.12; // NavPointer
const POINTER_ALPHA = 0.75;
const hex = (color) => '#' + color.toString(16).padStart(6, '0');

export class Hud {
  constructor(scene) {
    this.scene = scene;
    const text = (x, y, size, options = {}) =>
      scene.add
        .text(x, y, '', { fontFamily: FONT, fontSize: size + 'px', color: '#ffffff', shadow: SHADOW, ...options })
        .setScrollFactor(0)
        .setDepth(DEPTH);
    this.money = text(WINDOW_WIDTH - 4, 0, 22, { fontStyle: 'bold' }).setOrigin(1, 0).setAlpha(0.85);
    this.placing = text(WINDOW_WIDTH / 2, 0, 22, { fontStyle: 'bold' }).setOrigin(0.5, 0).setAlpha(0.85);
    this.bounty = text(WINDOW_WIDTH - 4, 42, 12, { color: BOUNTY_COLOR, fontStyle: 'bold' }).setOrigin(1, 0).setAlpha(0.85);
    this.bountyIcon = scene.add.image(0, 44, 'img:GUI_BountyPointsIcon').setOrigin(0, 0).setScrollFactor(0).setDepth(DEPTH);
    this.time = text(WINDOW_WIDTH - 4, 62, 12, { fontStyle: 'bold' }).setOrigin(1, 0).setAlpha(0.85);
    this.warning = text(WINDOW_WIDTH / 2, WINDOW_HEIGHT * 0.8, 15, { fontStyle: 'bold', color: '#ffe080', backgroundColor: 'rgba(0,0,0,0.45)', padding: { x: 6, y: 3 } }).setOrigin(0.5);
    this.input = text(5, WINDOW_HEIGHT - 20, 11, { backgroundColor: 'rgba(0,0,0,0.5)', padding: { x: 4, y: 2 } }).setVisible(false);
    this.messageTexts = [];
    this.messages = [];
    this.floaters = [];
    this.warnings = [];
    this.moneyValue = 0;
    this.pointer = scene.add.graphics().setScrollFactor(0).setDepth(DEPTH).setAlpha(POINTER_ALPHA);
    this.pointerName = text(0, 0, 10, { stroke: '#000000', strokeThickness: 3 }).setOrigin(0.5, 1);
    this.pointerPlace = text(0, 0, 10, { stroke: '#000000', strokeThickness: 3 }).setOrigin(0.5, 1);
    this.board = text(WINDOW_WIDTH / 2, 70, 12, { fontFamily: 'monospace', backgroundColor: 'rgba(0,0,0,0.75)', padding: { x: 12, y: 10 }, lineSpacing: 3 }).setOrigin(0.5, 0).setVisible(false);
    this.summary = scene.add.container(0, 0).setScrollFactor(0).setDepth(DEPTH + 1).setVisible(false);
  }

  setMoney(value) {
    this.moneyValue = value;
  }

  setPlacing(placing) {
    this.placing.setText(placing ? placingString(placing) : '');
  }

  setBountyPoints(points) {
    this.bounty.setText('BountyPoints ' + points);
    this.bountyIcon.setX(WINDOW_WIDTH - 4 - this.bounty.width - 22);
  }

  /** GUI.updateTime: minutes:seconds of play left. */
  setTime(seconds) {
    const s = Math.max(0, seconds);
    this.time.setText(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
  }

  /** GUI.showWarning; "[seconds]" counts down. */
  showWarning(message, ms) {
    this.warnings.push({ message, until: performance.now() + ms, ms });
  }

  clearWarnings() {
    this.warnings = [];
  }

  /** HudMessage: kill messages last 5 s, chat 8 s, then fade. */
  addMessage(text, { local = false, chat = false } = {}) {
    const length = chat ? 8000 : 5000;
    const fade = chat ? 200 : 500;
    const now = performance.now();
    this.messages.unshift({ text, color: chat ? CHAT_COLOR : local ? LOCAL_COLOR : REMOTE_COLOR, fadeAt: now + length, endAt: now + length + fade, fade });
    if (this.messages.length > MAX_MESSAGES) this.messages.pop();
  }

  /** The chat input line; null hides it. */
  setInput(value) {
    this.input.setVisible(value !== null);
    if (value !== null) this.input.setText('Say: ' + value + '_');
  }

  /** ScoreFloater: "+250" flies from the crate to the money display, which counts it on arrival. */
  addMoneyFloater(amount, screenX, screenY) {
    const label = this.scene.add
      .text(screenX, screenY, '' + amount, { fontFamily: FONT, fontSize: '14px', fontStyle: 'bold', color: '#80ff80', shadow: SHADOW })
      .setOrigin(0.5)
      .setScrollFactor(0)
      .setDepth(DEPTH);
    this.floaters.push({ amount, label, x: screenX, y: screenY, start: performance.now() });
  }

  /** CharacterPointer: an arrow at the screen edge towards the leader while they are off screen. */
  pointTo(target, cameraView) {
    const g = this.pointer;
    g.clear();
    this.pointerName.setVisible(false);
    this.pointerPlace.setVisible(false);
    if (!target) return;
    const cx = WINDOW_WIDTH / 2;
    const cy = WINDOW_HEIGHT / 2;
    let dx = target.character.renderPos.x * CELL_WIDTH - (cameraView.x + cx);
    let dy = target.character.renderPos.y * CELL_HEIGHT - (cameraView.y + cy);
    if (Math.abs(dx) <= cx && Math.abs(dy) <= cy) return; // on screen
    const scale = Math.abs(dy / dx) > WINDOW_HEIGHT / WINDOW_WIDTH ? Math.abs(cy / dy) : Math.abs(cx / dx);
    dx *= scale * (1 - EDGE_BUFFER);
    dy *= scale * (1 - EDGE_BUFFER);
    const angle = Math.atan2(dy / 0.7, dx);
    const x = Math.round(cx + dx);
    const y = Math.round(cy + dy);
    const point = (len, a) => ({ x: x + Math.cos(angle + a) * len, y: y + Math.sin(angle + a) * len });
    const tip = point(14, 0);
    const left = point(9, 2.4);
    const right = point(9, -2.4);
    g.fillStyle(target.color, 1).lineStyle(2, 0x000000, 1);
    g.fillTriangle(tip.x, tip.y, left.x, left.y, right.x, right.y);
    g.strokeTriangle(tip.x, tip.y, left.x, left.y, right.x, right.y);
    this.pointerPlace.setText(target.placing).setPosition(x, y - 12).setVisible(true);
    this.pointerName.setText(target.name).setColor(hex(target.color)).setPosition(x, y - 24).setVisible(true);
  }

  /** Tab scoreboard. rows: [{ name, stats, local }] in placing order */
  showScoreboard(title, rows) {
    if (!rows) {
      this.board.setVisible(false);
      return;
    }
    const pad = (s, n) => String(s).slice(0, n).padEnd(n);
    const lines = [title, '', `${pad('', 5)}${pad('Name', 20)}${pad('Score', 8)}${pad('Kills', 7)}${pad('Deaths', 8)}Bounty Pts`];
    for (const r of rows) lines.push(`${pad(placingString(r.stats.placing), 5)}${pad(r.name + (r.local ? ' *' : ''), 20)}${pad(r.stats.score, 8)}${pad(r.stats.kills, 7)}${pad(r.stats.deaths, 8)}${r.stats.bountyPoints}`);
    this.board.setText(lines.join('\n')).setVisible(true);
  }

  /** GameSummary: final standings, the five awards and the countdown to the next round. */
  showSummary(rows, awards) {
    const c = this.summary;
    c.removeAll(true);
    const add = (obj) => (c.add(obj), obj);
    add(this.scene.add.rectangle(WINDOW_WIDTH / 2, WINDOW_HEIGHT / 2, 560, 400, 0x000000, 0.8).setStrokeStyle(2, 0xffffff, 0.6));
    const t = (x, y, s, size, color = '#ffffff', origin = 0) => add(this.scene.add.text(x, y, s, { fontFamily: FONT, fontSize: size + 'px', color, fontStyle: 'bold' }).setOrigin(origin, 0));
    t(WINDOW_WIDTH / 2, 60, 'Round Over', 22, '#ffffff', 0.5);
    let y = 100;
    awards.forEach((a) => {
      t(100, y, a.title, 13, hex(a.color));
      t(260, y, a.player ? a.player.name : '-', 13);
      t(430, y, a.player ? a.caption : '', 11, '#cccccc');
      y += 22;
    });
    y += 12;
    t(100, y, 'Standings', 13, '#aaaaaa');
    y += 20;
    rows.slice(0, 8).forEach((r) => {
      t(100, y, placingString(r.stats.placing), 12, r.local ? LOCAL_COLOR : '#ffffff');
      t(150, y, r.name, 12, r.local ? LOCAL_COLOR : '#ffffff');
      t(330, y, `$${r.stats.score}`, 12);
      t(430, y, `${r.stats.kills} / ${r.stats.deaths}`, 12, '#cccccc');
      y += 18;
    });
    this.countdown = t(WINDOW_WIDTH / 2, 410, '', 12, '#cccccc', 0.5);
    c.setVisible(true);
  }

  setSummaryCountdown(seconds) {
    this.countdown?.setText(`Next Game begins in ${Math.max(0, seconds)} seconds...`);
  }

  update() {
    const now = performance.now();
    // Money shown minus what is still flying towards it.
    let money = this.moneyValue;
    this.floaters = this.floaters.filter((f) => {
      const tx = WINDOW_WIDTH - 100;
      const ty = 25;
      const distance = Math.hypot(tx - f.x, ty - f.y);
      const travelled = ((now - f.start) / 1000) * FLOATER_SPEED;
      if (travelled >= distance) {
        f.label.destroy();
        return false;
      }
      const k = travelled / distance;
      f.label.setPosition(f.x + (tx - f.x) * k, f.y + (ty - f.y) * k);
      money -= f.amount;
      return true;
    });
    this.money.setText('$' + money);

    this.warnings = this.warnings.filter((w) => w.until > now);
    const w = this.warnings[this.warnings.length - 1];
    if (w) {
      const left = Math.ceil((w.until - now) / 1000);
      this.warning.setText(w.message.replace('[seconds]', `${left} second${left === 1 ? '' : 's'}`)).setVisible(true);
    } else this.warning.setVisible(false);

    this.messages = this.messages.filter((m) => m.endAt > now);
    while (this.messageTexts.length < this.messages.length) {
      this.messageTexts.push(this.scene.add.text(5, 0, '', { fontFamily: FONT, fontSize: '11px', shadow: SHADOW }).setOrigin(0, 1).setScrollFactor(0).setDepth(DEPTH));
    }
    this.messageTexts.forEach((label, i) => {
      const m = this.messages[i];
      if (!m) return label.setVisible(false);
      const alpha = now < m.fadeAt ? 1 : Math.max(0, (m.endAt - now) / m.fade);
      label.setText(m.text).setColor(m.color).setAlpha(alpha).setY(WINDOW_HEIGHT - 26 - i * MESSAGE_HEIGHT).setVisible(true);
    });
  }

  destroy() {
    for (const obj of [this.money, this.placing, this.bounty, this.bountyIcon, this.time, this.warning, this.input, this.pointer, this.pointerName, this.pointerPlace, this.board, this.summary]) obj.destroy();
    for (const label of this.messageTexts) label.destroy();
    for (const f of this.floaters) f.label.destroy();
  }
}
