// Menus drawn as HTML over the game canvas: login, lobby (rooms, players,
// chat, host a game) and messages. Every string that comes from the server or
// other players is inserted with textContent, never as HTML.

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) if (child != null) node.append(child);
  return node;
}

export class Screens {
  constructor(root, handlers) {
    this.root = root;
    this.handlers = handlers;
  }

  clear() {
    this.root.replaceChildren();
    this.root.hidden = true;
    this.lobby = null;
  }

  show(...children) {
    this.root.replaceChildren(...children);
    this.root.hidden = false;
  }

  // --- simple messages -------------------------------------------------------

  message(title, text, actions = []) {
    this.show(
      el(
        'section',
        { class: 'panel narrow' },
        el('h1', {}, title),
        el('p', { class: 'muted' }, text),
        actions.length ? el('div', { class: 'row' }, actions.map(([label, fn]) => el('button', { onclick: fn }, label))) : null,
      ),
    );
  }

  // --- login -----------------------------------------------------------------

  login({ status = '', error = '', username = '' } = {}) {
    const user = el('input', { name: 'username', autocomplete: 'username', maxLength: 20, value: username, required: true });
    const pass = el('input', { name: 'password', type: 'password', autocomplete: 'current-password', maxLength: 20, required: true });
    const feedback = el('p', { class: error ? 'error' : 'muted', role: 'status' }, error || status);
    const form = el(
      'form',
      {
        class: 'panel narrow',
        onsubmit: (event) => {
          event.preventDefault();
          this.handlers.login(user.value.trim(), pass.value);
        },
      },
      el('h1', {}, 'Boxhead: Bounty Hunter'),
      el('label', {}, 'User name', user),
      el('label', {}, 'Password', pass),
      feedback,
      el(
        'div',
        { class: 'row' },
        el('button', { type: 'submit', class: 'primary' }, 'Log in'),
        el('button', { type: 'button', onclick: () => this.handlers.register(user.value.trim(), pass.value) }, 'Create account'),
      ),
      el('button', { type: 'button', class: 'link', onclick: () => this.handlers.offline() }, 'Offline practice (no server)'),
    );
    this.show(form);
    this.loginFeedback = feedback;
    (username ? pass : user).focus();
  }

  setLoginFeedback(text, isError = false) {
    if (!this.loginFeedback) return;
    this.loginFeedback.textContent = text;
    this.loginFeedback.className = isError ? 'error' : 'muted';
  }

  loginFailed(message) {
    this.setLoginFeedback(message || 'Login failed', true);
  }

  loginSucceeded() {}

  registerResult(ok, error) {
    if (ok) this.setLoginFeedback('Account created. You can log in now.');
    else this.setLoginFeedback(error, true);
  }

  // --- lobby -----------------------------------------------------------------

  showLobby({ user, maps }) {
    const rooms = el('ul', { class: 'list rooms' });
    const players = el('ul', { class: 'list players' });
    const chatLog = el('div', { class: 'chat-log', role: 'log', 'aria-live': 'polite' });
    const chatInput = el('input', { maxLength: 120, placeholder: 'Say something…' });
    const feedback = el('p', { class: 'muted', role: 'status' });

    const roomName = el('input', { maxLength: 20, value: `${user.name}'s game`, required: true });
    const mapSelect = el(
      'select',
      {},
      maps.map((map, slot) => (map ? el('option', { value: String(slot) }, map.name) : null)),
    );
    const isPrivate = el('input', { type: 'checkbox' });
    const privateName = el('input', { maxLength: 20, placeholder: 'Room name', required: true });

    this.show(
      el(
        'section',
        { class: 'panel wide lobby' },
        el(
          'header',
          { class: 'row spread' },
          el('h1', {}, 'Lobby'),
          el(
            'div',
            { class: 'row' },
            el('span', { class: 'muted' }, `Logged in as `, el('strong', {}, user.name)),
            el('button', { onclick: () => this.handlers.logout() }, 'Log out'),
          ),
        ),
        el(
          'div',
          { class: 'columns' },
          el(
            'div',
            {},
            el('div', { class: 'row spread' }, el('h2', {}, 'Games'), el('button', { onclick: () => this.handlers.refreshRooms() }, 'Refresh')),
            rooms,
            el(
              'form',
              {
                class: 'row',
                onsubmit: (event) => {
                  event.preventDefault();
                  this.handlers.joinRoom(privateName.value.trim());
                },
              },
              privateName,
              el('button', { type: 'submit' }, 'Join by name'),
            ),
            el('h2', {}, 'Host a game'),
            el(
              'form',
              {
                class: 'host',
                onsubmit: (event) => {
                  event.preventDefault();
                  this.handlers.createRoom({ name: roomName.value.trim(), map: parseInt(mapSelect.value, 10) || 0, isPrivate: isPrivate.checked });
                },
              },
              el('label', {}, 'Name', roomName),
              el('label', {}, 'Map', mapSelect),
              el('label', { class: 'check' }, isPrivate, 'Private (join by name only)'),
              el('button', { type: 'submit', class: 'primary' }, 'Create game'),
            ),
            feedback,
          ),
          el(
            'div',
            {},
            el('h2', {}, 'Players online'),
            players,
            el('h2', {}, 'Chat'),
            chatLog,
            el(
              'form',
              {
                class: 'row',
                onsubmit: (event) => {
                  event.preventDefault();
                  const text = chatInput.value.trim();
                  if (text) this.handlers.chat(text);
                  chatInput.value = '';
                },
              },
              chatInput,
              el('button', { type: 'submit' }, 'Send'),
            ),
          ),
        ),
      ),
    );
    this.lobby = { rooms, players, chatLog, feedback };
  }

  setRooms(list) {
    if (!this.lobby) return;
    const items = list.map((room) =>
      el(
        'li',
        {},
        el('span', { class: 'grow' }, room.name),
        el('span', { class: 'muted' }, `${room.players}/${room.maxPlayers}`),
        el('button', { onclick: () => this.handlers.joinRoom(room.name) }, 'Join'),
      ),
    );
    this.lobby.rooms.replaceChildren(...(items.length ? items : [el('li', { class: 'muted' }, 'No open games. Host one!')]));
  }

  setPlayers(users) {
    if (!this.lobby) return;
    this.lobby.players.replaceChildren(
      ...users.map((u) => el('li', {}, el('span', { class: 'grow' }, u.name || '…'), el('span', { class: 'muted' }, `$${u.stats.bounty}`))),
    );
  }

  addChat(name, text, kind = '') {
    if (!this.lobby) return;
    const log = this.lobby.chatLog;
    log.append(el('div', { class: 'chat ' + kind }, name ? el('strong', {}, name + ': ') : null, text));
    while (log.childElementCount > 100) log.firstElementChild.remove();
    log.scrollTop = log.scrollHeight;
  }

  setLobbyFeedback(text, isError = false) {
    if (!this.lobby) return;
    this.lobby.feedback.textContent = text;
    this.lobby.feedback.className = isError ? 'error' : 'muted';
  }

  roomError(creating) {
    this.setLobbyFeedback(creating ? 'Room name already in use' : 'Game not found', true);
  }
}
