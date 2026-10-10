// The lobby (MMOcha.lobby.MMOchaLobby and its windows), driven by App.js
// through FlashMenus: chat, players online, the game browser, joining by
// name, hosting a game, the notification popup and the Most Wanted tab.

import { MOST_WANTED_URL } from '../config.js';
import { COLORS, MODELS, tintFor } from '../game/bodyParts.js';
import { DIRECTIONS, SW } from '../game/Direction.js';
import { Social } from '../game/social.js';
import { moderatorHelp } from '../game/moderation.js';

const LOBBY_FRAME = 4; // background frames with the premiums tab hidden (Constants.HIDE_PREMIUMS)
const MOST_WANTED_FRAME = 6;
const WELCOME_COLOR = '#92a5ff'; // MMOchaLobby.WELCOME_COLOR
const MOD_MESSAGE_COLOR = '#afcfff'; // MMOchaLobby.MOD_MESAGE_COLOR
const GLOBAL_COLOR = '#ffff40'; // MMOchaLobby.globalMessage
const DISCONNECTION_MESSAGE = 'You have been disconnected.';
const CONNECTING_MESSAGE = 'Connecting to server...';
const JOINING_MESSAGE = 'Joining Lobby...';
const NAME_COLORS = { wanted: '#d72b2b', moderator: '#ffffff', normal: '#a6a6a6' }; // MMOchaUser colours (moderators: white)
const MAX_CHAT_LINES = 100;
const MAX_SENT = 10; // ChatWindow: messages remembered for the Up key
const SPAM_LIMIT = 5; // messages per SPAM_TIME (MMOchaLobby.setSpamLimits)
const SPAM_TIME = 5000;
const AUTO_REFRESH = 6000; // GameBrowserWindow.AUTO_REFRESH_TIME
const ROOM_RESTRICT = /[^0-9 a-zA-Z,.]/g; // HostGameWindow.RESTRICT
const MODES = [{ name: 'FFA', code: 'A' }]; // GAME_MODE_NAMES / CODES: the browser game plays free-for-all so far
const MAP_ROW = 18;
const NAME_INDENT = 15; // room for a player's icon (friend, moderator, most wanted...) before the name
const CHAT_HINT = 'Type a message…';
const FADE = 160; // ms: tabs and windows fade in

/** A short fade in (the Lobby / Most Wanted tabs, the lower-left windows). */
function fadeIn(el) {
  if (!el?.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE, easing: 'ease-out' });
}

const capitalize = (name) => (name ? name.charAt(0).toUpperCase() + name.substr(1) : '');
const nameColor = (user) => (user?.wanted ? NAME_COLORS.wanted : user?.level > 0 ? NAME_COLORS.moderator : NAME_COLORS.normal);
const byY = (list) => [...list].sort((a, b) => a.y - b.y);
const byX = (list) => [...list].sort((a, b) => a.x - b.x);
const sameName = (a, b) => !!a && !!b && (a.name || '').toLowerCase() === (b.name || '').toLowerCase();
const STATUS_HEIGHT = 18; // UserOptionsPopup.STATUS_HEIGHT
const STAGE_WIDTH = 700;
const STAGE_HEIGHT = 490;
const SVGNS = 'http://www.w3.org/2000/svg';
const GENDERS = ['Monster', 'Male', 'Female']; // Constants.MONSTER / MALE / FEMALE
const TURN_STEP = 20; // CustomizationWindow.mouseMove: pixels of drag per eighth of a turn
const PREVIEW_SCALE = 4; // the preview is drawn this much sharper than the window
const colorsOf = (part) => (COLORS[part] || [[1, 1, 1]]).map((_, i) => tintFor(part, i));

export class LobbyScreen {
  constructor(menus, { user, maps, serverName }) {
    this.menus = menus;
    this.lib = menus.lib;
    this.handlers = menus.handlers;
    this.user = user;
    this.maps = maps || [];
    this.players = [];
    this.rooms = [];
    this.timers = [];
    this.sent = [];
    this.interfaceEnabled = true;
    this.reconnecting = false;
    this.social = new Social();
    const root = (this.root = menus.add('MMOcha.lobby.MMOchaLobby'));
    this.background = root.child('background');
    this.windows = root.child('windows');
    this.mostWantedPage = root.child('mostWantedPage');
    root.child('premiumsPage').visible = false;
    for (const name of ['_userOptionsPopup', '_userStatsPopup', '_notificationPopup', '_gameBrowserWindow', '_hostGameWindow', '_quickMatchWindow', '_customizationWindow']) {
      const w = this.windows.child(name);
      if (w) w.visible = false;
    }
    this.setupTabs();
    this.setupMenu();
    this.setupChat(serverName);
    this.setupUserList();
    this.setupBrowser();
    this.setupHost();
    this.setupNotification();
    this.setupUserPopups();
    this.setupMostWanted();
    this.setupCustomization();
    this.setupInputs();
    this.showTab('lobby');
    this.showBrowser();
  }

  dispose() {
    this.closeUserPopups();
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  every(ms, fn) {
    const t = setInterval(fn, ms);
    this.timers.push(t);
    return t;
  }

  // --- tabs ------------------------------------------------------------------------------

  setupTabs() {
    const tab = (name, which) => {
      const button = this.root.child(name);
      button?.on('click', () => this.tab !== which && which !== 'premiums' && this.showTab(which));
    };
    tab('lobbyTab', 'lobby');
    tab('premiumsTab', 'premiums');
    tab('mostWantedTab', 'mostWanted');
  }

  /** MMOchaLobby.showTab */
  showTab(which) {
    this.menus.playSound('ClickShort');
    this.tab = which;
    const lobby = which === 'lobby';
    this.background.gotoAndStop(lobby ? LOBBY_FRAME : MOST_WANTED_FRAME);
    this.windows.visible = lobby;
    this.mostWantedPage.visible = !lobby;
    fadeIn((lobby ? this.windows : this.mostWantedPage).el);
    if (!lobby) this.loadMostWanted();
  }

  // --- menu window (Join Random, Host Game, Browse Games, Customize, Exit) ----------------------

  setupMenu() {
    const menu = (this.menuWindow = this.windows.child('_menuWindow'));
    const panel = menu.child('_gamesPanel');
    const loading = menu.child('_loadingPanel');
    if (loading) loading.visible = false; // the game art is already loaded
    const button = (name, text, fn) => {
      const b = panel?.child(name) || menu.child(name);
      if (!b) return null;
      b.text = text;
      b.onClick(fn);
      return b;
    };
    this.quickMatchButton = button('_quickMatchButton', 'Join Random', () => this.joinRandom());
    this.hostButton = button('_hostGameButton', 'Host Game', () => this.showHost());
    this.browseButton = button('_browseGamesButton', 'Browse Games', () => this.showBrowser());
    this.customizeButton = button('_customizeButton', 'Customize Character', () => this.showCustomization());
    this.exitButton = button('_exitButton', 'Exit', () => this.handlers.logout());
  }

  /** MMOchaLobby.openWindow: one window at a time in the lower left. */
  openWindow(win) {
    if (this.current && this.current !== win) this.closeWindow();
    if (this.current !== win) fadeIn(win.el);
    this.current = win;
    win.visible = true;
    this.windows.content.appendChild(win.el);
  }

  closeWindow() {
    const w = this.current;
    if (!w) return;
    w.visible = false;
    if (w === this.browser) {
      this.browseButton?.enable();
      clearInterval(this.refreshTimer);
    }
    if (w === this.host) this.hostButton?.enable();
    if (w === this.custom) this.customizeButton?.enable();
    this.current = null;
  }

  /** Every text box glows softly while typing in it; the chat box says what it is for. */
  setupInputs() {
    for (const box of this.root.el.querySelectorAll('input, textarea')) box.classList.add('lobby-input');
    this.chatInput.box.placeholder = CHAT_HINT;
  }

  // --- customization (MMOcha.lobby.CustomizationWindow) ----------------------------------------

  setupCustomization() {
    const win = (this.custom = this.windows.child('_customizationWindow'));
    if (!win) return;
    // The premiums (Devil and the rest) are free in this version: their panel stays hidden (Constants.HIDE_PREMIUMS).
    for (const name of ['premiumsLabel', '_premiumsScrollBar', '_getSomeButton', '_waitingAnim', '_premium0', '_premium1', '_premium2', '_premium3', '_premium4', '_premium5']) {
      const child = win.child(name);
      if (child) child.visible = false;
    }
    // The patched game's art relabelled rows for hair, skin tone and glasses options it never
    // finished (and the server ignores): hide those labels and call the third row what it sets.
    const LABELS = { skinTone: 625, hair: 624, glasses: 271 };
    const glasses = win.children.find((c) => c.id === LABELS.glasses);
    for (const c of win.children) if (Object.values(LABELS).includes(c.id)) c.visible = false;
    if (glasses) {
      const label = document.createElementNS(SVGNS, 'text');
      for (const [k, v] of Object.entries({ x: glasses.x + 1, y: glasses.y + 12.5, fill: '#ffffff', 'font-family': '"Myriad Pro", "Myriad Web Pro", Arial, sans-serif', 'font-size': 15 })) label.setAttribute(k, v);
      label.textContent = 'Gender';
      win.el.appendChild(label);
    }
    const sel = (name) => win.child(name);
    this.headModelSelector = sel('_headModelSelector');
    this.headColorSelector = sel('_headColorSelector');
    this.bodyModelSelector = sel('_bodyModelSelector');
    this.bodyColorSelector = sel('_bodyColorSelector');
    this.genderSelector = sel('_genderSelector');
    const on = (selector, fn) => selector?.el.addEventListener('change', fn);
    // optionChange: a new model starts on its default colour.
    on(this.headModelSelector, () => {
      this.look.headModel = this.headModelSelector.selectedOption;
      this.look.headColor = 0;
      this.showColors();
      this.drawPreview();
    });
    on(this.bodyModelSelector, () => {
      this.look.bodyModel = this.bodyModelSelector.selectedOption;
      this.look.bodyColor = 0;
      this.showColors();
      this.drawPreview();
    });
    on(this.headColorSelector, () => ((this.look.headColor = this.headColorSelector.selectedIndex), this.drawPreview()));
    on(this.bodyColorSelector, () => ((this.look.bodyColor = this.bodyColorSelector.selectedIndex), this.drawPreview()));
    on(this.genderSelector, () => (this.look.gender = this.genderSelector.selectedOption));

    const ok = win.child('_okButton');
    const cancel = win.child('_cancelButton');
    if (ok) ((ok.text = 'OK'), ok.onClick(() => this.saveCustomization()));
    if (cancel) ((cancel.text = 'Cancel'), cancel.onClick(() => this.showBrowser())); // back to the game list, not an empty panel

    // The preview: the character drawn over the window where _characterArea is; drag it to turn him.
    const area = win.child('_characterArea');
    if (!area) return;
    const [x0, y0, x1, y1] = area.bounds;
    area.visible = false;
    this.previewBox = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
    const image = (this.previewImage = document.createElementNS(SVGNS, 'image'));
    for (const [k, v] of Object.entries({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 })) image.setAttribute(k, v);
    image.style.cursor = 'grab';
    win.el.appendChild(image);
    image.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      image.setPointerCapture?.(event.pointerId);
      image.style.cursor = 'grabbing';
      const clickX = win.localPoint(event).x;
      const clickDir = this.previewDir.index;
      const move = (e) => {
        const steps = Math.trunc((win.localPoint(e).x - clickX) / TURN_STEP);
        const index = (((clickDir - steps) % DIRECTIONS.length) + DIRECTIONS.length) % DIRECTIONS.length;
        if (index !== this.previewDir.index) {
          this.previewDir = DIRECTIONS[index];
          this.drawPreview();
        }
      };
      const up = () => {
        image.style.cursor = 'grab';
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }

  /** CustomizationWindow.display: start from the player's current look. */
  showCustomization() {
    if (!this.custom) return;
    const u = this.user || {};
    this.look = { gender: GENDERS.includes(u.gender) ? u.gender : 'Male', headModel: u.headModel || 0, headColor: u.headColor || 0, bodyModel: u.bodyModel || 0, bodyColor: u.bodyColor || 0 };
    const models = MODELS.map((_, i) => i);
    const name = (i) => MODELS[i];
    this.genderSelector?.displayOptions('', GENDERS, this.look.gender);
    this.headModelSelector?.displayOptions('', models, this.look.headModel, name);
    this.bodyModelSelector?.displayOptions('', models, this.look.bodyModel, name);
    this.showColors();
    this.previewDir = SW;
    this.drawPreview();
    this.openWindow(this.custom);
    this.customizeButton?.disable(); // MMOchaLobby.showCustomizationWindow: greyed out while its window is open
  }

  showColors() {
    this.headColorSelector?.displayOptions('', colorsOf(MODELS[this.look.headModel] + 'Head'), this.look.headColor);
    this.bodyColorSelector?.displayOptions('', colorsOf(MODELS[this.look.bodyModel] + 'Body'), this.look.bodyColor);
  }

  /** updateCharacter: the character over his shadow, feet a little right of and below the middle. */
  drawPreview() {
    if (!this.previewImage || !this.menus.portrait) return;
    const { width, height } = this.previewBox;
    const canvas = this.menus.portrait(this.look, { width, height, x: Math.round(width * 0.55), y: Math.round(height * 0.5 + 10), dir: this.previewDir, scale: PREVIEW_SCALE });
    this.previewImage.setAttribute('href', canvas.toDataURL());
  }

  /** onOkClick: keep the look and send it to the server (MMOchaLobby.submitCustomization). */
  saveCustomization() {
    this.handlers.customize?.({ ...this.look });
    this.showBrowser(); // back to the game list, not an empty panel
  }

  /** Join Random: a random game with room left (QuickMatchWindow searched the server). */
  joinRandom() {
    const open = this.rooms.filter((r) => r.players < (r.maxPlayers || 16));
    if (!open.length) return this.notify('No games found. Host one!');
    this.joinRequested(open[Math.floor(Math.random() * open.length)].name);
  }

  // --- chat (MainChatWindow / ChatPage) -----------------------------------------------------

  setupChat(serverName) {
    const win = this.windows.child('_mainChatWindow');
    // MainChatWindow: the main chatroom's tab, then one tab per private conversation.
    this.lobbyPage = { user: null, nodes: null, waiting: false };
    this.page = this.lobbyPage;
    this.userPages = [];
    this.pageIndex = 0;
    this.lobbyTab = win.child('_lobbyTab');
    this.chatTabs = byX(win.children.filter((c) => c.className === 'MMOcha.lobby.ChatTab' && c !== this.lobbyTab));
    const tabName = this.lobbyTab?.child('_nameField');
    if (tabName) tabName.text = 'MAIN CHATROOM';
    const closeTab = this.lobbyTab?.child('_closeButton');
    if (closeTab) closeTab.visible = false;
    for (const tab of [this.lobbyTab, ...this.chatTabs].filter(Boolean)) {
      tab.el.style.cursor = 'pointer';
      const name = tab.child('_nameField');
      if (name) name.mouseEnabled = false;
      tab.on('click', () => {
        const page = tab === this.lobbyTab ? this.lobbyPage : tab.page;
        if (!page || page === this.page) return;
        this.menus.playSound('ClickShort');
        this.openPage(page);
      });
      tab.child('_closeButton')?.on('click', (event) => {
        event.stopPropagation();
        if (tab.page) this.closePage(tab.page);
      });
    }
    this.tabLeft = win.child('_leftButton');
    this.tabRight = win.child('_rightButton');
    this.tabLeft?.on('click', () => this.scrollTabsTo(this.pageIndex - 1));
    this.tabRight?.on('click', () => this.scrollTabsTo(this.pageIndex + 1));
    this.updateTabs();
    const page = win.child('_lobbyPage');
    this.chatField = page.child('_chatField');
    this.chatField.box.textContent = '';
    // ChatWindow pads the text with blank lines so that it sits at the bottom.
    this.chatField.box.classList.add('flash-chat');
    Object.assign(this.chatField.box.style, { whiteSpace: 'pre-wrap', overflow: 'hidden', pointerEvents: 'auto', userSelect: 'text' });
    this.chatInput = page.child('_inputField');
    this.chatInput.box.maxLength = 120;
    this.chatScroll = page.child('_scrollBar');
    const send = () => {
      const text = this.chatInput.text.trim();
      if (!text) return;
      this.chatInput.text = '';
      // ChatWindow.sendChatMessage: the last 10 messages sent from this page, newest first.
      const page = this.page;
      page.sent = [text, ...(page.sent || [])].slice(0, MAX_SENT);
      page.sentShown = -1;
      if (this.page.user) this.sendPrivateChat(text, this.page);
      else this.sendChat(text);
    };
    this.chatInput.box.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') send();
      else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        this.recallSent(event.key === 'ArrowUp' ? 1 : -1);
      }
    });
    page.child('_sendButton')?.on('click', () => (this.menus.playSound('ClickShort'), send()));
    const box = this.chatField.box;
    // Flash shows and scrolls whole lines: the space under the last full line stays empty.
    const line = this.chatField.lineHeight;
    const [, top, , bottom] = this.chatField.def.bounds;
    const lines = Math.floor((bottom - top - 4) / line);
    box.style.paddingBottom = `${bottom - top - 2 - lines * line}px`;
    const sync = () => this.syncChatScroll();
    box.addEventListener('scroll', sync);
    box.addEventListener('wheel', (event) => {
      box.scrollTop += event.deltaY > 0 ? line : -line;
      event.preventDefault();
    });
    this.chatScroll?.on('scrolldrag', (e) => (box.scrollTop = Math.round((e.detail * (box.scrollHeight - box.clientHeight)) / line) * line));
    this.chatScroll?.on('stepup', () => (box.scrollTop -= line));
    this.chatScroll?.on('stepdown', () => (box.scrollTop += line));
    this.serverName = serverName;
    this.printWelcome();
  }

  /** ChatWindow.onKeyRelease: Up brings back older messages you sent, Down newer ones, then an empty line. */
  recallSent(step) {
    const page = this.page;
    const sent = page.sent || [];
    const shown = page.sentShown ?? -1;
    const next = Math.max(-1, Math.min(sent.length - 1, shown + step));
    if (next === shown) return;
    page.sentShown = next;
    const box = this.chatInput.box;
    box.value = next < 0 ? '' : sent[next];
    box.setSelectionRange(box.value.length, box.value.length);
  }

  /** MMOchaLobby.generateWelcomeMessage */
  printWelcome(replacing = null) {
    const lines = [`Welcome to ${this.serverName}`, '-'.repeat(31)];
    if (replacing) {
      replacing.replaceChildren();
      const span = document.createElementNS('http://www.w3.org/1999/xhtml', 'span');
      span.textContent = lines[0];
      span.style.color = WELCOME_COLOR;
      replacing.appendChild(span);
      this.print([[lines[1], WELCOME_COLOR]], replacing);
      for (const line of moderatorHelp(this.user)) this.print([[line, MOD_MESSAGE_COLOR]]);
      return;
    }
    for (const line of lines) this.print([[line, WELCOME_COLOR]]);
    for (const line of moderatorHelp(this.user)) this.print([[line, MOD_MESSAGE_COLOR]]);
  }

  syncChatScroll() {
    const box = this.chatField.box;
    const range = box.scrollHeight - box.clientHeight;
    if (!this.chatScroll) return;
    this.chatScroll.handleSize = range > 0 ? box.clientHeight / box.scrollHeight : 1;
    this.chatScroll.scrollValue = range > 0 ? box.scrollTop / range : 0;
  }

  /** ChatWindow.print: keep the newest lines, follow them if we were at the bottom. */
  print(runs, after = null, page = this.lobbyPage) {
    if (page !== this.page) {
      // A page that is not showing keeps its lines aside; its tab lights up (ChatTab "Waiting").
      const line = this.chatField.appendRuns(runs);
      line.remove();
      page.nodes.push(line);
      while (page.nodes.length > MAX_CHAT_LINES) page.nodes.shift();
      page.waiting = true;
      this.updateTabs();
      return line;
    }
    const box = this.chatField.box;
    const atBottom = box.scrollTop >= box.scrollHeight - box.clientHeight - 2;
    const line = this.chatField.appendRuns(runs);
    if (after) after.after(line);
    while (box.childElementCount > MAX_CHAT_LINES) box.firstElementChild.remove();
    if (atBottom) box.scrollTop = box.scrollHeight;
    this.syncChatScroll();
    return line;
  }

  /** ChatWindow.replaceLast: the newest line reading `text`, or null. */
  lastLine(text) {
    const lines = [...this.chatField.box.children];
    return lines.reverse().find((line) => line.textContent === text) || null;
  }

  /** MMOchaLobby.checkSpamProtect: at most SPAM_LIMIT messages in SPAM_TIME. */
  sendChat(text) {
    if (!this.spamCheck(this.lobbyPage)) return;
    this.handlers.chat(text);
  }

  spamCheck(page) {
    if (!this.interfaceEnabled) return false;
    const now = Date.now();
    this.sent = this.sent.filter((t) => now - t < SPAM_TIME);
    if (this.sent.length >= SPAM_LIMIT) {
      this.print([['Please wait before sending another message.', NAME_COLORS.wanted]], null, page);
      return false;
    }
    this.sent.push(now);
    return true;
  }

  /** "<Name> message", the name in the sender's colour, "<<Name>>" for moderators (ChatWindow.print). */
  addChat(name, text, kind) {
    if (kind === 'warning') return this.print([[`Warning received from moderator: ${text}`, MOD_MESSAGE_COLOR]]);
    if (kind === 'system') return this.print([[`** ${text} **`, GLOBAL_COLOR]]);
    if (kind === 'notice') return this.print([[text, null]]);
    const user = kind === 'own' ? this.user : this.players.find((p) => p.name === name);
    if (user && user !== this.user && this.social.isBlocked(user.name)) return; // MMOchaLobby.handleMessage: blocked
    this.chatLine(user, name, text, this.lobbyPage);
  }

  /** One "<Name> message" line on a page; the name opens the player's options (MMOchaLobby.userNameClick). */
  chatLine(user, name, text, page) {
    const [open, close] = user?.level > 0 ? ['<<', '>>'] : ['<', '>'];
    const line = this.print([[`${open}${capitalize(name)}${close} `, nameColor(user)], [text, null]], null, page);
    const span = line.firstChild;
    if (user && span) {
      span.style.cursor = 'pointer';
      span.addEventListener('click', (event) => {
        const p = this.windows.localPoint(event);
        this.showUserOptions(user, p.x + 50, p.y);
      });
    }
    return line;
  }

  // --- private conversations (MainChatWindow user pages, ChatTab) ----------------------------------

  /** MMOchaLobby.privateMessageClick: open (or create) the conversation with a player and type there. */
  openPrivateChat(user) {
    if (!this.interfaceEnabled || !user || user === this.user || sameName(user, this.user)) return;
    if (this.tab !== 'lobby') this.showTab('lobby');
    this.openPage(this.userPage(user) || this.createUserPage(user));
    this.chatInput.box.focus();
  }

  userPage(user) {
    return this.userPages.find((page) => sameName(page.user, user)) || null;
  }

  createUserPage(user) {
    const page = { user, nodes: [], waiting: false, offscreenSoundPlayed: false };
    this.userPages.push(page);
    this.scrollTabsTo(this.userPages.length - 1);
    return page;
  }

  /** MainChatWindow.openPage: the chat field shows that page's lines. */
  openPage(page) {
    if (page === this.page) return;
    const box = this.chatField.box;
    this.page.nodes = [...box.children];
    this.page.scroll = box.scrollTop >= box.scrollHeight - box.clientHeight - 2 ? null : box.scrollTop;
    box.replaceChildren(...page.nodes);
    page.nodes = null;
    page.waiting = false;
    page.offscreenSoundPlayed = false;
    this.page = page;
    box.scrollTop = page.scroll ?? box.scrollHeight;
    this.syncChatScroll();
    this.updateTabs();
  }

  /** MainChatWindow.closeTabClick */
  closePage(page) {
    this.menus.playSound('ClickShort');
    if (this.page === page) this.openPage(this.lobbyPage);
    const index = this.userPages.indexOf(page);
    if (index < 0) return;
    this.userPages.splice(index, 1);
    this.scrollTabsTo(index);
  }

  /** MainChatWindow.reset: back to the main chatroom, every conversation closed. */
  resetPages() {
    this.openPage(this.lobbyPage);
    this.userPages = [];
    this.scrollTabsTo(0);
  }

  scrollTabsTo(index) {
    this.pageIndex = Math.max(0, Math.min(this.userPages.length - this.chatTabs.length, index));
    this.updateTabs();
  }

  /** MainChatWindow.updateTabs + ChatTab.setPage: names, and which tab is open or has new lines. */
  updateTabs() {
    const frame = (page) => (page === this.page ? 'Selected' : page.waiting ? 'Waiting' : 'Unselected');
    this.lobbyTab?.child('_background')?.gotoAndStop(frame(this.lobbyPage));
    this.chatTabs.forEach((tab, i) => {
      const page = this.userPages[this.pageIndex + i];
      tab.visible = !!page;
      tab.page = page || null;
      if (!page) return;
      tab.child('_nameField').text = capitalize(page.user.name);
      tab.child('_background')?.gotoAndStop(frame(page));
    });
    if (this.tabLeft) this.tabLeft.visible = this.pageIndex > 0;
    if (this.tabRight) this.tabRight.visible = this.pageIndex < this.userPages.length - this.chatTabs.length;
  }

  /** MMOchaLobby.sendPrivateChat: "c" + text to that player only, shown on their page. */
  sendPrivateChat(text, page) {
    if (!this.spamCheck(page)) return;
    if (this.handlers.moderate?.(text, (message) => this.print([[message, MOD_MESSAGE_COLOR]], null, page))) return;
    if (!this.players.some((p) => sameName(p, page.user))) {
      this.print([[`${capitalize(page.user.name)} is not in the lobby.`, null]], null, page);
      return;
    }
    this.handlers.privateMessage?.(page.user, text);
    this.chatLine(this.user, this.user?.name || 'You', text, page);
  }

  /** MMOchaLobby.handleMessage (PM): on that player's page, opened for the first message. */
  receivePrivate(user, text) {
    if (!user || this.social.isBlocked(user.name)) return;
    const page = this.userPage(user) || this.createUserPage(user);
    page.user = user;
    this.chatLine(user, user.name, text, page);
    if (page !== this.page && !page.offscreenSoundPlayed) {
      // SoundList.OFFSCREEN_CHAT used the respawn sound in the original game.
      this.menus.playSound('CharacterRespawn');
      page.offscreenSoundPlayed = true;
    }
  }

  // --- connection (MMOchaLobby.disconnected / connected / joinedLobby) --------------------------------

  /** MMOchaLobby.disableInterface: the menu buttons (Exit too unless keepExit) and the chat. */
  setInterface(enabled, keepExit = false) {
    this.interfaceEnabled = enabled;
    for (const b of [this.quickMatchButton, this.hostButton, this.browseButton, this.customizeButton]) {
      if (b) enabled ? b.enable() : b.disable();
    }
    if (this.exitButton) enabled || keepExit ? this.exitButton.enable() : this.exitButton.disable();
    this.chatInput.box.disabled = !enabled;
    if (enabled && this.current === this.browser) this.browseButton?.disable();
    if (enabled && this.current === this.host) this.hostButton?.disable();
    if (enabled && this.current === this.custom) this.customizeButton?.disable();
  }

  disconnected() {
    this.reconnecting = true;
    if (this.tab !== 'lobby') this.showTab('lobby');
    this.print([[DISCONNECTION_MESSAGE, null]]);
    this.print([[CONNECTING_MESSAGE, null]]);
    this.closeWindow();
    this.popup.visible = false;
    this.closeUserPopups();
    this.setInterface(false, true);
  }

  joining() {
    const line = this.lastLine(CONNECTING_MESSAGE);
    if (line) line.textContent = JOINING_MESSAGE;
    else this.print([[JOINING_MESSAGE, null]]);
  }

  /** Back in the lobby after a reconnection: same chat, fresh lists. */
  rejoined(user) {
    this.reconnecting = false;
    this.user = user;
    this.resetPages();
    const line = this.lastLine(JOINING_MESSAGE);
    this.printWelcome(line);
    this.players = [];
    this.setInterface(true);
    this.showBrowser();
  }

  /** Waiting for the server after Join or Create Game (MMOchaLobby.disableInterface). */
  joinRequested(name) {
    if (!this.interfaceEnabled || !name) return;
    this.setInterface(false);
    this.handlers.joinRoom(name);
  }

  /** MMOchaLobby.joinError / createError */
  roomError(creating) {
    this.setInterface(true);
    if (creating) {
      this.showHost();
      this.notify('Room name already in use');
    } else {
      this.showBrowser();
      this.notify('Game not found');
    }
  }

  // --- players online (UserListWindow / UserDisplay) --------------------------------------------

  setupUserList() {
    const win = this.windows.child('_userListWindow');
    this.userRows = byY(win.children.filter((c) => c.className === 'MMOcha.lobby.UserDisplay'));
    this.userScroll = win.child('_scrollBar');
    this.userIndex = 0;
    // UserDisplay: a click opens the player's options, a double click a private conversation.
    for (const row of this.userRows) {
      row.el.style.cursor = 'pointer';
      const name = row.child('_nameField');
      name.box.style.pointerEvents = 'auto';
      name.box.style.paddingLeft = `${2 + NAME_INDENT + (name.def.leftMargin || 0)}px`; // the icon sat on the first letter
      row.on('click', (event) => {
        if (!row.user) return;
        const p = this.windows.localPoint(event);
        this.showUserOptions(row.user, p.x - 50, p.y);
      });
      row.on('dblclick', () => {
        this.closeUserPopups();
        this.openPrivateChat(row.user);
      });
    }
    this.userScroll?.on('scrolldrag', (e) => this.showUsers(Math.round(e.detail * Math.max(0, this.players.length - this.userRows.length)), false));
    this.userScroll?.on('stepup', () => this.showUsers(this.userIndex - 1));
    this.userScroll?.on('stepdown', () => this.showUsers(this.userIndex + 1));
    win.on('wheel', (event) => {
      this.showUsers(this.userIndex + (event.deltaY > 0 ? 1 : -1));
      event.preventDefault();
    });
    this.setupOnlineTab(win);
    this.showUsers(0);
  }

  /** "N ONLINE" on a tab over the players list, drawn like the chat's MAIN CHATROOM tab. */
  setupOnlineTab(list) {
    const model = this.lobbyTab;
    if (!model) return;
    const tab = (this.onlineTab = this.lib.create('MMOcha.lobby.ChatTab'));
    tab.child('_closeButton') && (tab.child('_closeButton').visible = false);
    tab.child('_background')?.gotoAndStop('Unselected');
    tab.el.style.pointerEvents = 'none';
    model.el.parentNode.appendChild(tab.el);
    this.onlineTabList = list;
    this.placeOnlineTab();
  }

  /** Over the players list's top left as the chat tab is over the chat's (measured once it is drawn). */
  placeOnlineTab() {
    const tab = this.onlineTab;
    if (!tab || tab.placed) return;
    const list = this.onlineTabList.el.getBoundingClientRect();
    const chat = this.chatScroll?.el.getBoundingClientRect();
    const model = this.lobbyTab.el.getBoundingClientRect();
    const ctm = tab.el.parentNode.getScreenCTM?.();
    if (!list.width || !chat?.height || !ctm) return; // not drawn yet: next time
    tab.x = this.lobbyTab.x;
    tab.y = this.lobbyTab.y;
    const scale = ctm.a || 1;
    tab.x += (list.left + 3 - model.left) / scale;
    tab.y += (list.top - chat.top) / scale;
    tab.placed = true;
  }

  setPlayers(users) {
    const local = this.user;
    const before = this.players;
    this.players = this.social.order([local, ...users.filter((u) => u && u !== local)], local);
    // ChatPage.userDisconnected / a player back under a new id
    for (const page of this.userPages) {
      const now = this.players.find((p) => sameName(p, page.user));
      if (now) page.user = now;
      else if (before.some((p) => sameName(p, page.user))) this.print([[`${capitalize(page.user.name)} left the lobby.`, null]], null, page);
    }
    this.showUsers(this.userIndex);
    this.placeOnlineTab();
    const online = this.onlineTab?.child('_nameField');
    if (online) online.text = `${this.players.length} ONLINE`;
    if (this.statsPopup?.visible && this.statsUser) {
      const current = this.players.find((user) => sameName(user, this.statsUser));
      if (current) this.renderUserStats((this.statsUser = current));
    }
  }

  showUsers(index, moveBar = true) {
    const rows = this.userRows;
    this.userIndex = Math.max(0, Math.min(index, this.players.length - rows.length));
    rows.forEach((row, i) => {
      const user = this.players[this.userIndex + i];
      row.visible = !!user;
      row.user = user || null;
      if (!user) return;
      const name = row.child('_nameField');
      name.text = capitalize(user.name);
      name.box.style.color = nameColor(user); // most wanted red, moderators white, like their chat lines
      row.child('_icon')?.gotoAndStop(this.social.icon(user, this.user));
    });
    if (this.userScroll) {
      this.userScroll.handleSize = Math.max(0.2, Math.min(1, rows.length / Math.max(1, this.players.length)));
      if (moveBar) this.userScroll.scrollValue = this.userIndex / Math.max(1, this.players.length - rows.length);
    }
  }

  // --- game browser (GameBrowserWindow) ---------------------------------------------------------

  setupBrowser() {
    const win = (this.browser = this.windows.child('_gameBrowserWindow'));
    this.entries = byY(win.children.filter((c) => c.className === 'MMOcha.lobby.GameBrowserEntry'));
    this.privatePanel = win.child('_privatePanel');
    this.privateField = this.privatePanel.child('_privateField');
    this.privateField.box.maxLength = 20;
    this.privateField.box.addEventListener('input', () => {
      const up = this.privateField.box.value.toUpperCase();
      if (up !== this.privateField.box.value) this.privateField.box.value = up;
    });
    const joinPrivate = () => this.joinRequested(this.privateField.text.trim());
    this.privateField.box.addEventListener('keydown', (event) => event.key === 'Enter' && joinPrivate());
    const privateButton = this.privatePanel.child('_privateButton');
    privateButton.text = 'Join Private';
    privateButton.onClick(joinPrivate);
    this.joinButton = win.child('_joinButton');
    this.joinButton.text = 'Join';
    this.joinButton.disable();
    this.joinButton.onClick(() => this.selected && this.joinRequested(this.selected.roomName));
    this.noGames = win.child('_noGamesField');
    this.noGames.visible = false;
    this.noGames.mouseEnabled = false;
    this.info = win.child('_infoField');
    this.info.text = '';
    this.info.mouseEnabled = false;
    win.child('_inputCatch')?.on('click', () => this.deselect());
    this.browserScroll = win.child('_scrollBar');
    this.browserIndex = 0;
    this.browserScroll?.on('scrolldrag', (e) => this.showGames(Math.round(e.detail * Math.max(0, this.rooms.length - this.entries.length)), false));
    this.browserScroll?.on('stepup', () => this.showGames(this.browserIndex - 1));
    this.browserScroll?.on('stepdown', () => this.showGames(this.browserIndex + 1));
    for (const entry of this.entries) {
      entry.visible = false;
      entry.on('click', () => this.selectEntry(entry));
      entry.on('dblclick', () => this.joinRequested(entry.roomName));
    }
  }

  /** MMOchaLobby.showGameBrowserWindow + GameBrowserWindow.restart */
  showBrowser() {
    this.openWindow(this.browser);
    this.browseButton?.disable();
    this.deselect();
    this.handlers.refreshRooms();
    clearInterval(this.refreshTimer);
    this.refreshTimer = this.every(AUTO_REFRESH, () => this.current === this.browser && this.handlers.refreshRooms());
  }

  deselect() {
    this.selected?.deselect();
    this.selected = null;
    this.privatePanel.visible = true;
    this.joinButton.disable();
    this.info.text = '';
  }

  selectEntry(entry) {
    if (!entry.roomName) return;
    this.menus.playSound('ClickShort');
    this.selected?.deselect();
    entry.select();
    this.selected = entry;
    this.privatePanel.visible = false;
    this.joinButton.enable();
    this.info.text = '';
    this.handlers.requestRoomInfo?.(entry.roomName);
  }

  setRooms(rooms) {
    this.rooms = [...rooms];
    const selectedName = this.selected?.roomName;
    this.noGames.visible = this.rooms.length === 0;
    this.showGames(this.browserIndex);
    const still = this.entries.find((e) => e.visible && e.roomName === selectedName);
    if (selectedName && !still) this.deselect();
  }

  showGames(index, moveBar = true) {
    const entries = this.entries;
    this.browserIndex = Math.max(0, Math.min(index, this.rooms.length - entries.length));
    const selectedName = this.selected?.roomName;
    entries.forEach((entry, i) => {
      const room = this.rooms[this.browserIndex + i];
      entry.visible = !!room;
      entry.roomName = room?.name || null;
      if (!room) return;
      entry.child('_nameField').text = room.name;
      entry.child('_playersField').text = `${room.players}/${room.maxPlayers || 16}`;
      if (room.name === selectedName && entry !== this.selected) {
        this.selected?.deselect();
        entry.select();
        this.selected = entry;
      } else if (entry === this.selected && room.name !== selectedName) entry.deselect();
    });
    if (this.browserScroll) {
      this.browserScroll.handleSize = Math.max(0.2, Math.min(1, entries.length / Math.max(1, this.rooms.length)));
      if (moveBar) this.browserScroll.scrollValue = this.browserIndex / Math.max(1, this.rooms.length - entries.length);
    }
  }

  /** GameBrowserWindow.displayGameInfo */
  setRoomInfo(info) {
    if (!this.selected) return;
    const left = Math.max(0, (info.roundTime || 0) - 30);
    const time = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
    const mode = { A: 'FFA', B: 'Team Deathmatch', C: 'Infected', D: 'Last Survivor Infected' }[info.gameType] || 'FFA';
    const map = info.useCustomMaps ? 'Custom' : this.maps[info.mapID]?.name || 'Unknown';
    this.info.text = `${mode}\nMap: ${map}\nPlayers: ${info.players}\nRound Time: ${time}`;
  }

  // --- host game (HostGameWindow) -----------------------------------------------------------------

  setupHost() {
    const win = (this.host = this.windows.child('_hostGameWindow'));
    this.roomName = win.child('_nameField');
    this.roomName.box.maxLength = 20;
    this.roomName.box.addEventListener('input', () => {
      const clean = this.roomName.box.value.replace(ROOM_RESTRICT, '').toUpperCase();
      if (clean !== this.roomName.box.value) this.roomName.box.value = clean;
    });
    this.privateTick = win.child('_privateTickBox');
    this.privateTick.displayOption('Private', false);
    win.child('_mapRotationSelector')?.displayOptions('Map List:', ['Random', 'Cycle'], 'Random');
    const create = win.child('_createButton');
    create.text = 'Create Game';
    create.onClick(() => this.createGame());
    this.roomName.box.addEventListener('keydown', (event) => event.key === 'Enter' && this.createGame());
    this.buildMapList(win);
    this.buildModeBox(win);
  }

  /** HostGameWindow.displayMapList: a tick box per map in a scrolling pane, all ticked. */
  buildMapList(win) {
    const background = win.child('_mapsBackground');
    const [x, y, w, h] = [background.x, background.y, background.width, background.height];
    const pane = document.createElementNS(SVGNS, 'svg');
    Object.entries({ x, y, width: w, height: h, overflow: 'hidden' }).forEach(([k, v]) => pane.setAttribute(k, v));
    const content = document.createElementNS(SVGNS, 'g');
    pane.appendChild(content);
    win.content.appendChild(pane);
    this.mapTicks = [];
    let rowY = 3;
    this.maps.forEach((map, index) => {
      if (!map) return;
      const tick = this.lib.create('MMOcha.lobby.OptionTickBox');
      tick.displayOption(map.name, true);
      tick.x = 95;
      tick.y = rowY;
      tick.mapIndex = index;
      content.appendChild(tick.el);
      this.mapTicks.push(tick);
      rowY += MAP_ROW;
    });
    const paneHeight = rowY + 4;
    const scroll = win.child('_mapsScrollBar');
    let offset = 0;
    const scrollTo = (v) => {
      offset = Math.max(0, Math.min(1, v)) * Math.max(0, paneHeight - h);
      content.setAttribute('transform', `translate(0 ${-offset})`);
    };
    if (scroll) {
      scroll.visible = paneHeight > h;
      scroll.handleSize = h / Math.max(1, paneHeight);
      scroll.on('scrolldrag', (e) => scrollTo(e.detail));
      const step = (dir) => {
        scrollTo((offset + dir * MAP_ROW) / Math.max(1, paneHeight - h));
        scroll.scrollValue = offset / Math.max(1, paneHeight - h);
      };
      scroll.on('stepup', () => step(-1));
      scroll.on('stepdown', () => step(1));
    }
    // "Deselect All" sits over the map list, like the patched HostGameWindow.
    const deselect = this.lib.create('MMOcha.lobby.RoundLobbyButton');
    deselect.text = 'Deselect All';
    deselect.x = x + w - 95;
    deselect.y = y - 24;
    deselect.onClick(() => this.mapTicks.forEach((t) => (t.ticked = false)));
    win.addChild(deselect);
  }

  /** The patched HostGameWindow's "Game Modes" drop-down. */
  buildModeBox(win) {
    const tick = this.privateTick;
    const label = this.lib.create('MMOcha.lobby.OptionTickBox');
    label.displayOption('Game Modes', false);
    label.x = tick.x;
    label.y = tick.y + (tick.y - this.roomName.y);
    const box = label.child('_box');
    if (box) box.visible = false;
    for (const c of label.children) if (!c.name) c.visible = false; // the tick mark
    label.el.style.pointerEvents = 'none';
    win.addChild(label);
    const nameBox = win.children.find((c) => c.className === 'MMOcha.lobby.InnerBox' && Math.abs(c.y + c.height / 2 - (this.roomName.y + 6)) < 8);
    // The dropdown lines up with the room name box, but never runs into its own label.
    const labelField = label.child('_optionField');
    const measure = document.createElement('canvas').getContext('2d');
    if (labelField) measure.font = labelField.box.style.font;
    const labelRight = labelField ? label.x + labelField.x + labelField.def.bounds[0] + 2 + measure.measureText(labelField.text).width + 6 : 0;
    const left = nameBox ? nameBox.x : this.roomName.x - 4;
    const right = left + (nameBox ? nameBox.width : 150);
    const bx = Math.max(left, labelRight);
    const width = right - bx;
    const rowHeight = Math.max(12, nameBox ? Math.round(nameBox.height) : 14);
    const by = label.y - 1; // the row text on the label's baseline
    const g = (attrs) => {
      const el = document.createElementNS(SVGNS, attrs.tag);
      for (const [k, v] of Object.entries(attrs)) if (k !== 'tag' && k !== 'text') el.setAttribute(k, v);
      if (attrs.text) el.textContent = attrs.text;
      return el;
    };
    const row = (y, text) => {
      const group = g({ tag: 'g', transform: `translate(${bx} ${y})`, style: 'cursor:pointer' });
      const rect = g({ tag: 'rect', width, height: rowHeight, fill: '#1a1a1a', stroke: '#272727', 'stroke-width': 1 });
      group.append(rect, g({ tag: 'text', x: 3, y: rowHeight - 3, fill: '#ffffff', 'font-size': 10, 'font-family': '"BBH Arial", Arial, sans-serif', text }));
      group.addEventListener('pointerenter', () => rect.setAttribute('fill', '#333333'));
      group.addEventListener('pointerleave', () => rect.setAttribute('fill', '#1a1a1a'));
      return group;
    };
    this.mode = MODES[0];
    const field = row(by, this.mode.name);
    field.appendChild(g({ tag: 'path', d: `M${width - 11} ${rowHeight / 2 - 2}L${width - 4} ${rowHeight / 2 - 2}L${width - 7.5} ${rowHeight / 2 + 2}Z`, fill: '#ffffff' }));
    const list = g({ tag: 'g', style: 'display:none' });
    MODES.forEach((mode, i) => {
      const item = row(by + rowHeight * (i + 1), mode.name);
      item.addEventListener('click', () => {
        this.mode = mode;
        field.querySelector('text').textContent = mode.name;
        list.style.display = 'none';
      });
      list.appendChild(item);
    });
    field.addEventListener('click', () => (list.style.display = list.style.display === 'none' ? '' : 'none'));
    win.content.append(field, list);
  }

  /** MMOchaLobby.showGameHostingWindow: the name defaults to "<Name>'s Game". */
  showHost() {
    if (!this.roomName.text) {
      const name = capitalize(this.user?.name || 'Player');
      this.roomName.text = (name.endsWith('s') ? `${name}' Game` : `${name}'s Game`).toUpperCase();
    }
    this.openWindow(this.host);
    this.hostButton?.disable();
  }

  createGame() {
    const maps = this.mapTicks.filter((t) => t.ticked).map((t) => t.mapIndex);
    if (!maps.length) return this.notify('Select at least one map');
    const name = this.roomName.text.trim();
    if (!name) return this.notify('Enter a name for your game');
    if (!this.interfaceEnabled) return;
    this.closeWindow();
    this.setInterface(false, true);
    this.handlers.createRoom({ name, maps, map: maps[0], isPrivate: this.privateTick.ticked, gameType: this.mode.code });
  }

  // --- notification popup -----------------------------------------------------------------------------

  setupNotification() {
    this.popup = this.windows.child('_notificationPopup');
    const ok = this.popup.child('_okButton');
    ok.text = 'OK';
    ok.onClick(() => (this.popup.visible = false));
  }

  /** MMOchaLobby.showNotificationPopup */
  notify(message) {
    if (this.tab !== 'lobby') this.showTab('lobby');
    this.popup.child('_messageField').text = message;
    this.popup.visible = true;
    this.windows.content.appendChild(this.popup.el);
  }

  // --- a player's options and stats (UserOptionsPopup, UserStatsPopup) ---------------------------

  setupUserPopups() {
    const popup = (this.optionsPopup = this.windows.child('_userOptionsPopup'));
    this.statsPopup = this.windows.child('_userStatsPopup');
    if (!popup || !this.statsPopup) return;
    const buttons = (this.popupButtons = popup.child('_buttons'));
    const button = (name, text, fn) => {
      const b = buttons.child(name);
      b.text = text;
      b.baseY = b.y;
      b.onClick((event) => {
        const user = this.popupUser;
        this.closeUserPopups();
        if (user) fn(user, event);
      });
      return b;
    };
    const social = (fn) => (user) => {
      fn(user);
      this.setPlayers(this.players); // UserList.updateUserSocialStatus: re-sorted, new icon
    };
    this.optionButtons = {
      privateMessage: button('_privateMessageButton', 'Private Message', (user) => this.openPrivateChat(user)),
      stats: button('_statsButton', 'View Stats', (user, event) => {
        const p = this.windows.localPoint(event);
        this.showUserStats(user, p.x, p.y);
      }),
      addFriend: button('_addFriendButton', 'Add Friend', social((user) => this.social.setFriend(user.name, true))),
      removeFriend: button('_removeFriendButton', 'Remove Friend', social((user) => this.social.setFriend(user.name, false))),
      addIgnore: button('_addIgnoreButton', 'Block', social((user) => this.social.setBlocked(user.name, true))),
      removeIgnore: button('_removeIgnoreButton', 'Unblock', social((user) => this.social.setBlocked(user.name, false))),
    };
    this.buttonsY = buttons.y;
    this.statusRows = { moderator: popup.child('_moderator'), wanted: popup.child('_wanted') };
    for (const row of Object.values(this.statusRows)) row.baseY = row.y;
    this.popupBackground = popup.child('_background');
    // A click anywhere else closes them (UserOptionsPopup / UserStatsPopup.mouseUp).
    this.onPopupPointerUp = (event) => {
      if (this.optionsPopup.visible && !this.optionsPopup.el.contains(event.target)) this.closeUserPopups();
      else if (this.statsPopup.visible && this.statsShownAt < performance.now() - 50) this.closeUserPopups();
    };
  }

  /**
   * MMOchaLobby.showUserOptionsPopup: View Stats for yourself; for anyone else
   * Private Message, View Stats, Add / Remove Friend and Block / Unblock, under
   * their Moderator! and Wanted! status.
   */
  showUserOptions(user, x, y) {
    if (!this.interfaceEnabled || !this.optionsPopup || !user) return;
    this.closeUserPopups();
    const popup = this.optionsPopup;
    const local = user === this.user || sameName(user, this.user);
    this.popupUser = user;
    let buttonsY = this.buttonsY;
    let wantedY = this.statusRows.wanted.baseY;
    const status = (row, show, frame, text, color) => {
      row.visible = show;
      if (!show) return false;
      row.child('_icon')?.gotoAndStop(frame);
      const field = row.child('_textField');
      field.autoSize = 'left';
      field.text = text;
      field.box.style.color = color;
      row.x = -Math.round(row.width / 2); // centred over the buttons
      return true;
    };
    const wanted = status(this.statusRows.wanted, !!user.wanted, 'Wanted', 'Wanted!', NAME_COLORS.wanted);
    if (!wanted) buttonsY -= STATUS_HEIGHT;
    const moderator = status(this.statusRows.moderator, user.level > 0, 'Moderator', 'Moderator!', NAME_COLORS.moderator);
    if (!moderator) {
      buttonsY -= STATUS_HEIGHT;
      wantedY -= STATUS_HEIGHT;
    }
    this.statusRows.wanted.y = wantedY;
    this.popupButtons.y = buttonsY;
    const b = this.optionButtons;
    const friend = this.social.isFriend(user.name);
    const blocked = this.social.isBlocked(user.name);
    const shown = local ? [b.stats] : [b.privateMessage, b.stats, friend ? b.removeFriend : b.addFriend, blocked ? b.removeIgnore : b.addIgnore];
    for (const button of Object.values(b)) {
      button.visible = shown.includes(button);
      button.y = button.baseY;
    }
    if (local) b.stats.y = b.privateMessage.baseY;
    // The background fits what is shown, with the same margin above and below.
    const last = shown[shown.length - 1];
    const top = moderator || wanted ? 0 : buttonsY + b.privateMessage.baseY;
    const bottom = buttonsY + last.y + last.height;
    const height = bottom - top + 2 * Math.max(0, top) + 8 + (moderator || wanted ? 4 : 0);
    this.popupBackground.scaleY = height / 100;
    this.placePopup(popup, x, y, 76, -4, height - 4);
  }

  /** MMOchaLobby.showUserStatsPopup: Bounty Points, Kills, Deaths, Wins and Rounds. */
  showUserStats(user, x, y) {
    if (!this.interfaceEnabled || !this.statsPopup || !user) return;
    this.closeUserPopups();
    const popup = this.statsPopup;
    this.statsUser = user;
    this.renderUserStats(user);
    const waiting = popup.child('_waitingAnim');
    if (waiting) waiting.visible = false;
    this.statsShownAt = performance.now();
    this.placePopup(popup, x, y, 76, -14, 104);
  }

  /** Redraw an open stats panel when fresh profile totals arrive. */
  renderUserStats(user) {
    const popup = this.statsPopup;
    const name = popup.child('_nameField');
    name.text = capitalize(user.name);
    name.box.style.color = nameColor(user);
    const stats = user.stats || {};
    const n = (v) => String(v || 0);
    popup.child('_statsField').text = 'Bounty Points\nKills\nDeaths\nWins\nRounds';
    popup.child('_valuesField').text = [stats.bounty, stats.kills, stats.deaths, stats.wins, (stats.wins || 0) + (stats.losses || 0)].map(n).join('\n');
  }

  /** Show a popup at (x, y), kept inside the stage (MMOchaLobby.constrainPopup). */
  placePopup(popup, x, y, halfWidth, top, bottom) {
    popup.x = Math.round(Math.max(halfWidth, Math.min(STAGE_WIDTH - halfWidth, x)));
    popup.y = Math.round(Math.max(-top, Math.min(STAGE_HEIGHT - bottom, y)));
    popup.visible = true;
    this.windows.content.appendChild(popup.el);
    // From the next click on: the one that opened it is still going up.
    requestAnimationFrame(() => window.addEventListener('pointerup', this.onPopupPointerUp));
  }

  closeUserPopups() {
    window.removeEventListener('pointerup', this.onPopupPointerUp);
    if (this.optionsPopup) this.optionsPopup.visible = false;
    if (this.statsPopup) this.statsPopup.visible = false;
    this.popupUser = null;
  }

  // --- Most Wanted (MostWantedPage) -----------------------------------------------------------------

  setupMostWanted() {
    const page = this.mostWantedPage;
    this.mostWanted = null;
    this.mostWantedIndex = 0;
    page.child('leaderCharacterBox')?.useGoldOutline();
    page.child('leaderPointsField').autoSize = 'center';
    this.wantedDisplays = [2, 3, 4, 5, 6, 7, 8, 9].map((i) => page.child('mwd' + i)).filter(Boolean);
    for (const display of this.wantedDisplays) {
      display.child('pointsField').autoSize = 'center';
      display.child('nameField').text = '';
    }
    this.wantedRows = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => page.child('mwle' + i)).filter(Boolean);
    for (const row of this.wantedRows) {
      row.child('background')?.gotoAndStop(1);
      row.child('rankField').autoSize = 'left';
      row.child('pointsField').autoSize = 'right';
    }
    const bar = (this.wantedScroll = page.child('scrollBar'));
    if (bar) {
      bar.visible = false;
      const extra = () => Math.max(0, (this.mostWanted?.length || 0) - 17);
      const scrollTo = (index, moveBar) => {
        this.mostWantedIndex = Math.max(0, Math.min(index, extra()));
        this.showWantedList();
        if (moveBar) bar.scrollValue = this.mostWantedIndex / Math.max(1, extra());
      };
      bar.on('scrolldrag', (e) => scrollTo(Math.floor(e.detail * extra()), false));
      bar.on('stepup', () => scrollTo(this.mostWantedIndex - 1, true));
      bar.on('stepdown', () => scrollTo(this.mostWantedIndex + 1, true));
    }
    this.showMostWanted([]);
    const loading = page.child('loadingDisplay');
    if (loading) loading.visible = true;
  }

  /** MMOchaLobby.requestMostWantedList: show the last list at once, then fetch a new one. */
  async loadMostWanted() {
    if (this.mostWanted) this.showMostWanted(this.mostWanted);
    let list = [];
    try {
      const response = await fetch(MOST_WANTED_URL, { cache: 'no-store' });
      if (!response.ok) throw new Error(response.status);
      const xml = new DOMParser().parseFromString(await response.text(), 'application/xml');
      const number = (node, path) => parseInt(node.querySelector(path)?.textContent || '0', 10) || 0;
      list = [...xml.querySelectorAll('users > user')].map((u, i) => ({
        rank: i + 1,
        name: capitalize(u.querySelector('name')?.textContent || ''),
        points: number(u, 'bountyPoints'),
        look: { headModel: number(u, 'head > model'), headColor: number(u, 'head > color'), bodyModel: number(u, 'body > model'), bodyColor: number(u, 'body > color') },
      }));
    } catch {
      list = this.mostWanted || [];
    }
    this.mostWanted = list;
    if (this.tab === 'mostWanted') this.showMostWanted(list);
  }

  /** MostWantedPage.updateAll: the leader, 2nd to 9th with pictures, then the list. */
  showMostWanted(list) {
    const page = this.mostWantedPage;
    const loading = page.child('loadingDisplay');
    if (loading) loading.visible = false;
    const leader = list[0];
    const box = page.child('leaderCharacterBox');
    const points = page.child('leaderPointsField');
    const symbol = page.child('leaderPointsSymbol');
    page.child('leaderNameField').text = leader ? leader.name : '';
    points.text = leader ? String(leader.points) : '';
    symbol.visible = !!leader;
    if (leader) symbol.x = points.fieldX - 12;
    this.drawPortrait(box, leader);
    this.wantedDisplays.forEach((display, i) => {
      const entry = list[i + 1];
      const field = display.child('pointsField');
      const icon = display.child('pointsSymbol');
      display.child('nameField').text = entry ? entry.name : '';
      field.text = entry ? String(entry.points) : '';
      icon.visible = !!entry;
      if (entry) icon.x = field.fieldX - 8;
      this.drawPortrait(display.child('characterBox'), entry);
    });
    this.showWantedList();
  }

  drawPortrait(box, entry) {
    if (!box) return;
    if (!entry) return box.clear();
    box.drawCharacter(this.menus.portrait?.(entry.look) || null);
  }

  /** MostWantedPage.updateList: 10th place onwards, eight rows, scrolling past 17 players. */
  showWantedList() {
    const list = this.mostWanted || [];
    this.wantedRows.forEach((row, i) => {
      const entry = list[9 + this.mostWantedIndex + i];
      const rank = row.child('rankField');
      const name = row.child('nameField');
      const points = row.child('pointsField');
      const icon = row.child('pointsSymbol');
      if (!entry) {
        row.child('background')?.gotoAndStop(1);
        rank.text = '';
        name.text = '';
        points.text = '';
        icon.visible = false;
        return;
      }
      row.child('background')?.gotoAndStop(((entry.rank + 1) % 2) + 1);
      rank.text = entry.rank + ')';
      name.x = Math.trunc(rank.fieldX + rank.width + 1);
      name.text = entry.name;
      points.text = String(entry.points);
      icon.x = points.fieldX - 7;
      icon.visible = true;
    });
    if (this.wantedScroll) this.wantedScroll.visible = list.length > 17;
  }
}
