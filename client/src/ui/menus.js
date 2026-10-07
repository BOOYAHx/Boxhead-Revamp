// The original menus, rebuilt from the exported Flash art: main menu, server
// choice, connecting, login/register (MMOchaLogin), how to play, options and
// the lobby (lobby.js). Each screen follows its ActionScript class.

import { FlashLibrary, Stage } from './flash.js';
import { LobbyScreen } from './lobby.js';
import { installWidgets } from './widgets.js';
import { FOOTSTEPS, Preferences, resetPreferences, savePreferences } from '../game/preferences.js';

// MainMenuScreen fade, in frames at 30 fps.
const PRE_FADE = 5;
const FADE_BACKDROP = PRE_FADE + 50;
const FADE_WAIT = FADE_BACKDROP + 25;
const FADE_BUTTONS = FADE_WAIT + 40;
const NAME_RESTRICT = /[^a-zA-Z0-9.,]/g; // MMOchaLogin: restrict "a-zA-Z0-9.,", maxChars 20
const REMEMBER_KEY = 'bbh.login';

function remembered() {
  try {
    return JSON.parse(localStorage.getItem(REMEMBER_KEY) || '{}');
  } catch {
    return {};
  }
}

function remember(data) {
  try {
    localStorage.setItem(REMEMBER_KEY, JSON.stringify({ ...remembered(), ...data }));
  } catch {
    // storage unavailable
  }
}

export class FlashMenus {
  /** Load the exported art; rejects when it is missing (the HTML menus are used instead). */
  static async create(root, handlers, options) {
    const lib = await FlashLibrary.load();
    return new FlashMenus(root, lib, handlers, options);
  }

  /**
   * options.playSound(name): a UI sound; options.portrait(look): a canvas with
   * that character's picture (the Most Wanted page); options.serverName.
   */
  constructor(root, lib, handlers, { playSound = () => {}, portrait = null, serverName = 'Squaresville' } = {}) {
    this.root = root;
    this.lib = lib;
    this.handlers = handlers;
    this.playSound = playSound;
    this.portrait = portrait;
    this.serverName = serverName;
    installWidgets(lib, { playSound: (name) => this.playSound(name) });
    this.frame = document.createElement('div');
    this.frame.className = 'flash-stage';
    root.appendChild(this.frame);
    this.stage = new Stage(this.frame);
    this.timers = [];
    this.lobby = null;
  }

  // --- helpers ---------------------------------------------------------------------

  add(symbol, parent = this.stage) {
    return parent.addChild(this.lib.create(symbol));
  }

  /** Remove every screen (and stop their timers). */
  reset() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
    this.lobby?.dispose();
    this.lobby = null;
    this.login_ = null;
    this.loginBox = null;
    this.subscreen = null;
    this.stage.clear();
    this.state = null;
    this.menuScreen = null;
    this.buttonsPanel = null;
    this.root.hidden = false;
  }

  every(ms, fn) {
    const t = setInterval(fn, ms);
    this.timers.push(t);
    return t;
  }

  /** Hide the menus (in game). */
  clear() {
    this.reset();
    this.root.hidden = true;
  }

  // --- main menu (MainMenuScreen + Backdrop) ------------------------------------------

  mainMenu({ fade = false } = {}) {
    if (!fade && this.state === 'menu' && this.menuScreen) {
      this.closeSubscreen();
      return;
    }
    this.reset();
    this.state = 'menu';
    const backdrop = (this.backdrop = this.add('boxhead.ui.Backdrop'));
    const screen = (this.menuScreen = this.add('boxhead.ui.screen.MainMenuScreen'));
    const panel = (this.buttonsPanel = screen.child('buttonsPanel'));
    const actions = {
      loginButton: () => (this.playSound('ClickLong'), this.serverSelect()),
      quickPlayButton: () => (this.playSound('ClickShort'), this.handlers.offline()),
      howToPlayButton: () => (this.playSound('ClickShort'), this.howToPlay()),
      optionsButton: () => (this.playSound('ClickShort'), this.options()),
    };
    for (const [name, action] of Object.entries(actions)) panel.child(name)?.on('click', () => this.menuEnabled && action());
    this.menuEnabled = true;
    if (!fade) return;
    // Backdrop fades in, then the buttons; a click on the backdrop skips it.
    let frame = 0;
    backdrop.alpha = 0;
    panel.alpha = 0;
    this.menuEnabled = false;
    const end = () => {
      clearInterval(timer);
      backdrop.alpha = 1;
      panel.alpha = 1;
      this.menuEnabled = true;
    };
    const timer = this.every(1000 / 30, () => {
      frame += 1;
      if (frame >= FADE_BUTTONS) end();
      else if (frame > FADE_WAIT) panel.alpha = Math.pow((frame - FADE_WAIT) / (FADE_BUTTONS - FADE_WAIT), 1.5);
      else if (frame === FADE_WAIT) this.menuEnabled = true;
      else if (frame > PRE_FADE && frame < FADE_BACKDROP) backdrop.alpha = Math.pow((frame - PRE_FADE) / (FADE_BACKDROP - PRE_FADE), 2.5);
      else if (frame >= FADE_BACKDROP) backdrop.alpha = 1;
    });
    backdrop.on('click', end);
  }

  ensureMainMenu() {
    if (this.state !== 'menu' || !this.menuScreen) this.mainMenu();
    this.closeSubscreen();
  }

  closeSubscreen() {
    for (const screen of [this.subscreen, this.login_]) {
      if (!screen) continue;
      this.stage.removeChild(screen);
      screen.destroy();
    }
    this.subscreen = null;
    this.login_ = null;
    this.loginBox = null;
    if (this.buttonsPanel) this.buttonsPanel.visible = true;
  }

  /** ServerSelectScreen: one server here; "connect" or "back". */
  serverSelect() {
    this.ensureMainMenu();
    this.buttonsPanel.visible = false;
    const screen = (this.subscreen = this.add('boxhead.ui.screen.ServerSelectScreen'));
    const field = screen.child('serverField');
    if (field) field.text = this.serverName;
    screen.child('leftButton')?.disable?.();
    screen.child('rightButton')?.disable?.();
    const connect = screen.child('connectButton');
    connect.text = 'connect';
    connect.useLongClick?.();
    connect.onClick(() => this.handlers.connect());
    const back = screen.child('closeButton');
    back.text = 'back';
    back.align('right');
    back.onClick(() => this.closeSubscreen());
  }

  /** ConnectingScreen: "connecting...", then failure messages; "cancel"/"back". */
  connecting(status = 'Connecting') {
    this.ensureMainMenu();
    this.buttonsPanel.visible = false;
    const screen = (this.subscreen = this.add('boxhead.ui.screen.ConnectingScreen'));
    screen.child('status')?.gotoAndStop(status);
    const close = screen.child('closeButton');
    close.text = status === 'Connecting' ? 'cancel' : 'back';
    close.onClick(() => {
      this.handlers.cancelConnect();
      this.closeSubscreen();
    });
  }

  connectionFailed() {
    this.connecting('ConnectionFailed');
  }

  authenticationFailed() {
    this.connecting('AuthenticationFailed');
  }

  // --- login (MMOchaLogin) -------------------------------------------------------------

  login({ username = '', error = '', status = '' } = {}) {
    this.ensureMainMenu();
    const box = (this.login_ = this.add('MMOcha.lobby.MMOchaLogin'));
    const loginButtons = box.child('_loginButtons');
    const registerButtons = box.child('_registerButtons');
    const name = box.child('_nameField');
    const password = box.child('_passwordField');
    const confirm = registerButtons.child('_confirmField');
    const statusField = box.child('_statusField');
    for (const field of [name, password, confirm]) {
      field.box.maxLength = 20;
      field.box.addEventListener('input', () => {
        const clean = field.box.value.replace(NAME_RESTRICT, '');
        if (clean !== field.box.value) field.box.value = clean;
      });
    }
    password.box.type = 'password';
    confirm.box.type = 'password';
    name.box.autocomplete = 'username';
    password.box.autocomplete = 'current-password';
    confirm.box.autocomplete = 'new-password';
    const saved = remembered();
    const tick = loginButtons.child('_rememberTickBox');
    tick.ticked = !!saved.rememberMe;
    tick.on('change', () => remember({ rememberMe: tick.ticked }));
    name.text = username || (saved.rememberMe ? saved.username || '' : '');
    registerButtons.visible = false;
    let panel = 'login'; // which buttons are shown
    let busy = null; // 'login' or 'register' while waiting for the server
    const buttons = {
      login: loginButtons.child('_loginButton'),
      register: loginButtons.child('_registerButton'),
      submit: registerButtons.child('_submitButton'),
      back: registerButtons.child('_backButton'),
    };
    const enable = (on) => Object.values(buttons).forEach((b) => (on ? b.enable() : b.disable()));
    const show = (message, color = '#990000') => {
      statusField.text = message || '';
      statusField.box.style.color = color;
    };
    const check = () => {
      if (name.text.length < 3 || name.text.length > 20) return show('Invalid User Name (3-20 characters required)'), false;
      if (password.text.length < 3 || password.text.length > 20) return show('Invalid Password (3-20 characters required)'), false;
      return true;
    };
    const submitLogin = () => {
      if (busy) return;
      show('');
      if (!check()) return;
      busy = 'login';
      enable(false);
      this.handlers.login(name.text, password.text);
    };
    const submitRegister = () => {
      if (busy) return;
      show('');
      if (!check()) return;
      if (password.text !== confirm.text) return show('Password confirmation does not match');
      busy = 'register';
      enable(false);
      this.handlers.register(name.text, password.text);
    };
    const setPanel = (which) => {
      panel = which;
      loginButtons.visible = which === 'login';
      registerButtons.visible = which === 'register';
      confirm.text = '';
      show('');
    };
    const label = (button, text, fn) => {
      button.text = text;
      button.onClick(fn);
    };
    label(buttons.login, 'Login', submitLogin);
    label(buttons.register, 'Register', () => setPanel('register'));
    label(buttons.submit, 'Submit', submitRegister);
    label(buttons.back, 'Back', () => setPanel('login'));
    label(box.child('_closeButton'), 'Cancel', () => {
      busy = null;
      this.handlers.cancelConnect();
    });
    // MMOchaLogin.keyUp: Enter moves from the name to the password, then submits; Tab cycles the fields.
    const focus = (field, selectAll) => {
      field.focus();
      const end = field.box.value.length;
      field.box.setSelectionRange(selectAll ? 0 : end, end);
    };
    name.box.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') focus(password, true);
      else if (event.key === 'Tab') (event.preventDefault(), focus(password));
    });
    password.box.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') submitLogin();
      else if (event.key === 'Tab') (event.preventDefault(), focus(panel === 'register' ? confirm : name));
    });
    confirm.box.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') submitRegister();
      else if (event.key === 'Tab') (event.preventDefault(), focus(name));
    });
    this.loginBox = {
      show,
      /** The server refused the login (MMOchaLogin.authenticationError). */
      failed: (message) => {
        busy = null;
        enable(true);
        show(message || 'Login failed');
      },
      succeeded: () => {
        busy = null;
        if (tick.ticked) remember({ username: name.text });
      },
      /** MMOchaLogin.registerResult: log straight in with the new account. */
      registered: (ok, message) => {
        if (busy !== 'register') return;
        busy = null;
        if (!ok) {
          enable(true);
          show(message || 'Account creation failed');
          return;
        }
        if (tick.ticked) remember({ username: name.text });
        setPanel('login');
        submitLogin();
      },
    };
    show(error || status, error ? '#990000' : '#ffffff');
    setTimeout(() => (name.text ? password : name).focus(), 0);
  }

  setLoginFeedback(message, isError) {
    this.loginBox?.show(message, isError ? '#990000' : '#ffffff');
  }

  loginFailed(message) {
    this.loginBox?.failed(message);
  }

  loginSucceeded() {
    this.loginBox?.succeeded();
  }

  registerResult(ok, error) {
    this.loginBox?.registered(ok, error);
  }

  /** BanScreen: banned, server full or a duplicate login; "close" returns to the menu. */
  banScreen(title, message) {
    this.ensureMainMenu();
    this.buttonsPanel.visible = false;
    const screen = (this.subscreen = this.add('boxhead.ui.screen.BanScreen'));
    screen.child('banField').text = title;
    screen.child('messageField').text = message;
    const close = screen.child('closeButton');
    close.text = 'close';
    close.onClick(() => this.closeSubscreen());
  }

  // --- how to play and options ------------------------------------------------------------

  /** HowToPlayScreen: four slides, a click shows the next one. */
  howToPlay() {
    this.ensureMainMenu();
    this.buttonsPanel.visible = false;
    const screen = (this.subscreen = this.add('boxhead.ui.screen.HowToPlayScreen'));
    const slides = screen.child('slides');
    const skip = screen.child('clickToSkip');
    let slide = 1;
    slides.gotoAndStop(1);
    let frame = 0;
    this.every(1000 / 30, () => skip && skip.totalFrames > 1 && skip.gotoAndStop((frame = (frame % skip.totalFrames) + 1)));
    screen.el.style.cursor = 'pointer';
    screen.on('click', () => {
      this.playSound('ClickShort');
      slide += 1;
      if (slide > slides.totalFrames) this.closeSubscreen();
      else slides.gotoAndStop(slide);
    });
  }

  /** OptionsScreen: the game options, saved in the browser. */
  options() {
    this.ensureMainMenu();
    this.buttonsPanel.visible = false;
    const screen = (this.subscreen = this.add('boxhead.ui.screen.OptionsScreen'));
    const ticks = {
      autoShopTickBox: ['Open shop on death', 'autoShop'],
      shadowTickBox: ['Shadows', 'shadows'],
      bloodTickBox: ['Blood', 'blood'],
      shellsTickBox: ['Shell Casings', 'shells'],
      smokeTickBox: ['Smoke', 'smoke'],
      shakeTickBox: ['Screen Shake', 'shake'],
      showFPSTickBox: ['Show FPS', 'showFPS'],
    };
    const volume = screen.child('volumeSlider');
    const footsteps = screen.child('footstepsSelector');
    // The patched game's AutoReload.attach: an "Auto Reload" tick box where the
    // footsteps selector was, which moves down a row with the buttons below it.
    // "Enhanced Graphics" (this edition's sharper picture and effects) is added the same way.
    const fps = screen.child('showFPSTickBox');
    const row = footsteps.y - fps.y > 0 ? footsteps.y - fps.y : 24;
    const extras = [['autoReload', 'Auto Reload'], ['enhanced', 'Enhanced Graphics']].map(([key, label]) => {
      const tick = this.lib.create('MMOcha.lobby.OptionTickBox');
      tick.matrix = [...fps.matrix];
      tick.y = footsteps.y;
      for (const name of ['footstepsSelector', 'controlsButton', 'weaponsButton']) screen.child(name).y += row;
      screen.addChild(tick);
      return { key, label, tick };
    });
    const display = () => {
      volume.displayOptions('Volume', Preferences.volume);
      for (const [name, [label, key]] of Object.entries(ticks)) screen.child(name)?.displayOption(label, Preferences[key]);
      for (const { key, label, tick } of extras) tick.displayOption(label, Preferences[key]);
      footsteps.displayOptions('Footstep Sounds', [FOOTSTEPS.OFF, FOOTSTEPS.PLAYER, FOOTSTEPS.ON], Preferences.footsteps);
    };
    display();
    const changed = () => {
      Preferences.volume = volume.value;
      for (const [name, [, key]] of Object.entries(ticks)) Preferences[key] = !!screen.child(name)?.ticked;
      for (const { key, tick } of extras) Preferences[key] = tick.ticked;
      Preferences.footsteps = footsteps.selectedOption;
      savePreferences();
      this.handlers.preferencesChanged?.();
    };
    volume.on('change', changed);
    footsteps.on('change', changed);
    for (const { tick } of extras) tick.on('change', changed);
    for (const name of Object.keys(ticks)) screen.child(name)?.on('change', changed);
    // Key and weapon-bank configuration come with the in-game menus.
    for (const [name, text] of [['controlsButton', 'configure controls'], ['weaponsButton', 'configure weapon banks']]) {
      const button = screen.child(name);
      button.text = text;
      button.align('left');
      button.disable();
    }
    const reset = screen.child('resetButton');
    reset.text = 'reset';
    reset.align('left');
    reset.onClick(() => {
      resetPreferences();
      savePreferences();
      display();
      this.handlers.preferencesChanged?.();
    });
    const close = screen.child('closeButton');
    close.text = 'close';
    close.align('right');
    close.onClick(() => this.closeSubscreen());
  }

  // --- lobby ------------------------------------------------------------------------------

  showLobby({ user, maps }) {
    if (this.state === 'lobby' && this.lobby?.reconnecting) {
      this.lobby.rejoined(user);
      return;
    }
    this.reset();
    this.state = 'lobby';
    this.lobby = new LobbyScreen(this, { user, maps, serverName: this.serverName });
  }

  setPlayers(users) {
    this.lobby?.setPlayers(users);
  }

  setRooms(rooms) {
    this.lobby?.setRooms(rooms);
  }

  setRoomInfo(info) {
    this.lobby?.setRoomInfo(info);
  }

  setLobbyFeedback(message, isError) {
    if (isError) this.lobby?.notify(message);
  }

  /** The server refused a join (or a create, when the name is taken). */
  roomError(creating) {
    this.lobby?.roomError(creating);
  }

  addChat(name, text, kind) {
    this.lobby?.addChat(name, text, kind);
  }

  lobbyDisconnected() {
    this.lobby?.disconnected();
  }

  lobbyJoining() {
    this.lobby?.joining();
  }

  lobbyNotice(message) {
    this.lobby?.addChat('', message, 'notice');
  }
}
