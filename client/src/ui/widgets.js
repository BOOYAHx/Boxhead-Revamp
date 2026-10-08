// Behaviour of the original lobby widgets (MMOcha.lobby.*), attached to the
// symbols when they are created, the way Flash linked symbols to classes.

const IDENTITY = [[1, 1, 1, 1], [0, 0, 0, 0]];
const RED = [[0.55, 0, 0, 1], [0, 0, 0, 0]]; // TextButton.RED (pressed)
const DISABLED = [[0.4, 0.4, 0.4, 1], [0, 0, 0, 0]]; // LobbyButton
const ROUND_DISABLED = [[0.6, 0.6, 0.6, 1], [0, 0, 0, 0]]; // RoundLobbyButton

/** Colour transform on a display object or a raw SVG group. */
function setColor(lib, target, cxform) {
  const el = target.el || target;
  if (!cxform || cxform === IDENTITY) el.removeAttribute('filter');
  else el.setAttribute('filter', `url(#${lib.filter(cxform, null)})`);
}

/**
 * TextButton / RoundLobbyButton "added": a button stretched in the editor is
 * drawn at its height's scale so the label is not squashed; the label is
 * re-centred over the stretched width and the background and hit area keep it.
 */
function unstretch(button) {
  button.textWidth = labelFields(button)[0]?.width || 0;
  const [a, , , d] = button.matrix;
  if (Math.abs(a - d) < 1e-6 || !d) return;
  const width = button.width;
  const ratio = a / d;
  button.matrix[0] = d;
  button.updateTransform();
  const textWidth = (button.textWidth = width / d);
  for (const state of ['up', 'over', 'down']) {
    for (const child of button.stateChildren[state]) {
      if (child.box) child.x = Math.trunc(textWidth - child.width) / 2;
      else child.scaleX = ratio;
    }
  }
  button.groups.hit.setAttribute('transform', `scale(${ratio} 1)`);
}

function labelFields(button) {
  return button.allChildren().filter((c) => c.box);
}

function addButtonApi(button, ui, { disabledColor = DISABLED, sound = 'ClickShort' } = {}) {
  button.sound = sound;
  button.enable = () => {
    button.enabled = true;
    setColor(button.lib, button, IDENTITY);
  };
  button.disable = () => {
    button.enabled = false;
    setColor(button.lib, button, disabledColor);
  };
  Object.defineProperty(button, 'text', {
    get: () => labelFields(button)[0]?.text || '',
    set: (value) => {
      for (const field of labelFields(button)) field.text = value;
    },
  });
  /** A click handler that respects enabled and plays the button sound (LobbyButton.click). */
  button.onClick = (fn) =>
    button.on('click', (event) => {
      if (!button.enabled) return;
      ui.playSound(button.sound);
      fn(event);
    });
  button.useLongClick = () => (button.sound = 'ClickLong');
}

function textButton(ui) {
  return (button) => {
    unstretch(button);
    button.groups.up.style.opacity = '0.5';
    setColor(button.lib, button.groups.down, RED);
    modernText(button);
    addButtonApi(button, ui);
    /** TextButton.align: the label to the left, right or centre of the button. */
    button.align = (side) => {
      const where = side.toLowerCase().charAt(0);
      for (const field of labelFields(button)) {
        const spare = Math.trunc(button.textWidth - field.width);
        field.x = where === 'l' ? 0 : where === 'r' ? spare : spare / 2;
        field.box.style.textAlign = where === 'l' ? 'left' : where === 'r' ? 'right' : 'center';
      }
    };
  };
}

function roundButton(ui) {
  return (button) => {
    unstretch(button);
    modernPill(button);
    addButtonApi(button, ui, { disabledColor: ROUND_DISABLED });
  };
}

const SVGNS = 'http://www.w3.org/2000/svg';

/** Keep classes on a button for its hover, pressed and disabled looks (css/style.css). */
function trackStates(button) {
  const refresh = button.refresh.bind(button);
  button.refresh = () => {
    refresh();
    const on = button._enabled;
    button.el.classList.toggle('is-hover', on && button.hover);
    button.el.classList.toggle('is-down', on && button.pressed);
    button.el.classList.toggle('is-disabled', !on);
  };
  button.refresh();
}

/**
 * TextButton (the player options, Options screen and menu links), modernised:
 * the same white label, half-lit at rest and red when pressed, now with a soft
 * capsule behind it on hover, a press and a faded disabled look.
 */
function modernText(button) {
  const hit = button.stateChildren.hit[0];
  const b = hit?.bounds;
  if (!b) return;
  // The hit area may be stretched sideways (unstretch); the capsule is drawn already stretched,
  // since a transform attribute would also be swung round the press's transform-origin.
  const ratio = parseFloat(/scale\(([\d.]+)/.exec(button.groups.hit.getAttribute('transform') || '')?.[1]) || 1;
  const [x0, y0, x1, y1] = [b[0] * ratio, b[1], b[2] * ratio, b[3]];
  const g = document.createElementNS(SVGNS, 'g');
  g.setAttribute('class', 'text-capsule');
  const h = y1 - y0;
  g.innerHTML = `<rect x="${x0 + 1}" y="${y0 + 1}" width="${Math.max(0, x1 - x0 - 2)}" height="${Math.max(0, h - 2)}" rx="${(h - 2) / 2}"/>`;
  button.el.insertBefore(g, button.el.firstChild);
  button.el.classList.add('text-button');
  for (const part of [g, button.groups.up, button.groups.over, button.groups.down]) part.style.transformOrigin = `${(x0 + x1) / 2}px ${(y0 + y1) / 2}px`;
  trackStates(button);
}
const PILL = { width: 148, height: 24, x: 0.1, y: 0.1 }; // the original's 9-slice pill bitmap (148 x 24)

/**
 * RoundLobbyButton, redrawn: the same dark fill (#303030) and grey ring
 * (#6c6c6c) as the original bitmap, as a crisp vector pill with a faint top
 * light; it glows on hover, sinks when pressed and fades when disabled
 * (css/style.css .pill-button). The label is the original text field.
 */
function modernPill(button) {
  const art = button.stateChildren.up.find((c) => !c.box);
  if (!art) return;
  const width = PILL.width * (art.scaleX || 1);
  const { height, x, y } = PILL;
  for (const state of ['up', 'over', 'down']) for (const child of button.stateChildren[state]) if (!child.box) child.visible = false;
  const id = button.lib.newID('pill');
  const g = document.createElementNS(SVGNS, 'g');
  g.setAttribute('class', 'pill');
  g.innerHTML =
    `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">` +
    '<stop offset="0" stop-color="#3a3a3a"/><stop offset="0.5" stop-color="#303030"/><stop offset="1" stop-color="#272727"/>' +
    '</linearGradient></defs>' +
    `<rect class="pill-body" x="${x}" y="${y}" width="${width}" height="${height}" rx="${height / 2}" fill="url(#${id})" stroke="#303030" stroke-width="1"/>` +
    `<rect class="pill-ring" x="${x + 2.5}" y="${y + 2.5}" width="${width - 5}" height="${height - 5}" rx="${(height - 5) / 2}" fill="none" stroke-width="1.2"/>` +
    `<path class="pill-light" d="M${x + height / 2} ${y + 3.6} H${x + width - height / 2}" stroke="#ffffff" stroke-opacity="0.09" stroke-width="1" stroke-linecap="round"/>`;
  button.el.insertBefore(g, button.el.firstChild);
  button.el.classList.add('pill-button');
  // Pressing sinks the pill and label together, around the middle.
  const origin = `${x + width / 2}px ${y + height / 2}px`;
  for (const part of [g, button.groups.up, button.groups.over, button.groups.down]) part.style.transformOrigin = origin;
  trackStates(button);
}

function lobbyButton(ui) {
  return (button) => addButtonApi(button, ui);
}

/** TickBox: frames "Ticked"/"Unticked"; a click toggles it and fires "change". */
function tickBox(ui) {
  return (clip) => {
    let ticked = false;
    clip.gotoAndStop('Unticked');
    clip.el.style.cursor = 'pointer';
    Object.defineProperty(clip, 'ticked', {
      get: () => ticked,
      set: (value) => {
        ticked = !!value;
        clip.gotoAndStop(ticked ? 'Ticked' : 'Unticked');
      },
    });
    clip.on('click', () => {
      clip.ticked = !ticked;
      ui.playSound('ClickShort');
      clip.el.dispatchEvent(new Event('change'));
    });
    clip.displayOption = (name, value = false) => {
      const field = clip.getChildByName('_optionField');
      if (field) field.text = name || '';
      clip.ticked = value;
    };
  };
}

/** OptionSelector: "< value >" with arrow buttons; fires "change". */
function optionSelector() {
  return (clip) => {
    let options = [];
    let index = -1;
    let label = String; // how a value is shown (the customization window names the models)
    const valueField = clip.getChildByName('_valueField');
    const left = clip.getChildByName('_leftButton');
    const right = clip.getChildByName('_rightButton');
    const select = (i, notify = true) => {
      if (i === index) return;
      if (i <= 0) left?.disable?.();
      else left?.enable?.();
      if (i >= options.length - 1) right?.disable?.();
      else right?.enable?.();
      index = i;
      if (valueField) valueField.text = options[i] === undefined ? '' : label(options[i]);
      if (notify) clip.el.dispatchEvent(new Event('change'));
    };
    left?.onClick?.(() => index > 0 && select(index - 1));
    right?.onClick?.(() => index < options.length - 1 && select(index + 1));
    clip.displayOptions = (name, list, selected, format = String) => {
      options = list || [];
      label = format;
      const field = clip.getChildByName('_optionField');
      if (field) field.text = name || '';
      index = -1;
      select(Math.max(0, options.lastIndexOf(selected)), false);
    };
    Object.defineProperty(clip, 'selectedOption', { get: () => options[index] });
    Object.defineProperty(clip, 'selectedIndex', { get: () => index });
    clip.selectIndex = select;
  };
}

/**
 * ColorSelector: "< colour >" with a swatch (_colorBlock) showing the colour;
 * options are 0xRRGGBB values, the swatch is multiplied by the selected one
 * (CharacterColorFinish.tone); fires "change".
 */
function colorSelector(lib) {
  return (clip) => {
    let options = [];
    let index = -1;
    const block = clip.getChildByName('_colorBlock');
    const left = clip.getChildByName('_leftButton');
    const right = clip.getChildByName('_rightButton');
    const select = (i, notify = true) => {
      if (i === index) return;
      if (i <= 0) left?.disable?.();
      else left?.enable?.();
      if (i >= options.length - 1) right?.disable?.();
      else right?.enable?.();
      index = i;
      const rgb = options[i] ?? 0xffffff;
      if (block) setColor(lib, block, [[((rgb >> 16) & 255) / 255, ((rgb >> 8) & 255) / 255, (rgb & 255) / 255, 1], [0, 0, 0, 0]]);
      if (notify) clip.el.dispatchEvent(new Event('change'));
    };
    left?.onClick?.(() => index > 0 && select(index - 1));
    right?.onClick?.(() => index < options.length - 1 && select(index + 1));
    clip.displayOptions = (name, list, selectedIndex = 0) => {
      options = list || [];
      const field = clip.getChildByName('_optionField');
      if (field) field.text = name || '';
      index = -1;
      select(Math.max(0, Math.min(options.length - 1, selectedIndex)), false);
    };
    Object.defineProperty(clip, 'selectedIndex', { get: () => index });
  };
}

/** Slider (and OptionSlider): drag along the bar for a value 0..1; fires "change". */
function slider() {
  return (clip) => {
    const handle = clip.getChildByName('_handle');
    const bar = clip.getChildByName('_bar');
    const background = clip.getChildByName('_background');
    let value = 0.5;
    if (handle && clip.scaleX) handle.scaleX = 1 / clip.scaleX;
    const update = () => {
      if (handle && background) handle.x = value * background.width;
    };
    Object.defineProperty(clip, 'value', {
      get: () => value,
      set: (v) => {
        value = Math.max(0, Math.min(1, v));
        update();
      },
    });
    const input = (event) => {
      const width = bar?.width || background?.width || 1;
      clip.value = clip.localPoint(event).x / width;
      clip.el.dispatchEvent(new Event('change'));
    };
    clip.el.style.cursor = 'pointer';
    clip.on('pointerdown', (event) => {
      clip.el.setPointerCapture?.(event.pointerId);
      input(event);
      const move = (e) => input(e);
      const up = () => {
        clip.el.removeEventListener('pointermove', move);
        clip.el.removeEventListener('pointerup', up);
      };
      clip.el.addEventListener('pointermove', move);
      clip.el.addEventListener('pointerup', up);
    });
    update();
  };
}

function optionSlider() {
  return (clip) => {
    const inner = clip.getChildByName('_slider');
    Object.defineProperty(clip, 'value', { get: () => inner?.value ?? 0, set: (v) => inner && (inner.value = v) });
    clip.displayOptions = (name, value = 0.5) => {
      const field = clip.getChildByName('_optionField');
      if (field && name) field.text = name;
      clip.value = value;
    };
    inner?.on('change', () => clip.el.dispatchEvent(new Event('change')));
  };
}

const SCROLL_HEIGHT = 100; // ScrollBar.DEFAULT_HEIGHT
const SLIM_TRACK = 4; // stage pixels
const SLIM_THUMB = 6;

/**
 * The slim scrollbar drawn over a ScrollBar clip, in stage pixels (the clip
 * itself is stretched to its height): parts keep working but are not drawn.
 */
function slimScrollBar(clip, parts, sx, sy) {
  const make = (tag, attrs) => {
    const el = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    return el;
  };
  for (const part of parts) part.el.setAttribute('opacity', '0');
  const g = make('g', { class: 'slim-scroll', transform: `scale(${1 / sx} ${1 / sy})` });
  g.style.pointerEvents = 'none';
  const middle = 5 * sx; // the middle of the 10-wide clip, in stage pixels
  const track = make('rect', { class: 'slim-track', x: middle - SLIM_TRACK / 2, width: SLIM_TRACK, rx: SLIM_TRACK / 2 });
  const thumb = make('rect', { class: 'slim-thumb', x: middle - SLIM_THUMB / 2, width: SLIM_THUMB, rx: SLIM_THUMB / 2 });
  g.append(track, thumb);
  clip.el.appendChild(g);
  clip.el.addEventListener('pointerenter', () => g.classList.add('is-hover'));
  clip.el.addEventListener('pointerleave', () => g.classList.remove('is-hover'));
  return {
    place(background, handle) {
      const top = 2 * sy;
      track.setAttribute('y', top);
      track.setAttribute('height', Math.max(0, SCROLL_HEIGHT * sy - 2 * top));
      thumb.setAttribute('y', handle.y * sy);
      thumb.setAttribute('height', Math.max(SLIM_THUMB, handle.height * sy));
      // A list that fits needs no thumb.
      thumb.style.display = background.height - handle.height < 0.5 ? 'none' : '';
    },
  };
}

/**
 * ScrollBar: arrows, a track and a handle sized to the visible share.
 * Fires "scrolldrag" (detail = 0..1), "stepup" and "stepdown".
 */
function scrollBar(ui) {
  return (clip) => {
    const background = clip.getChildByName('_background');
    const handle = clip.getChildByName('_handle');
    const up = clip.getChildByName('_upButton');
    const down = clip.getChildByName('_downButton');
    if (!background || !handle || !up || !down) return;
    const sx = clip.scaleX;
    const sy = clip.scaleY;
    // ScrollBar.arrange: arrows keep their shape whatever the bar's height.
    up.scaleY = (-Math.abs(up.scaleX) * sx) / sy;
    down.scaleY = (Math.abs(down.scaleX) * sx) / sy;
    up.y = up.height / 2;
    down.y = SCROLL_HEIGHT - down.height / 2;
    const handleNatural = handle.height / Math.abs(handle.scaleY || 1);
    const backgroundNatural = background.height / Math.abs(background.scaleY || 1);
    background.scaleY = (SCROLL_HEIGHT - up.height - down.height) / backgroundNatural;
    background.y = up.height;
    let scrollValue = 0;
    let handleSize = 0.4;
    // This build's look: a slim rounded track and thumb drawn over the original
    // parts, which stay (invisible) for dragging, clicking the track and the arrows.
    const slim = slimScrollBar(clip, [background, handle, up, down], sx, sy);
    const place = () => {
      handle.scaleY = Math.max(0.05, (background.height * handleSize) / handleNatural);
      handle.y = background.y + scrollValue * (background.height - handle.height);
      slim.place(background, handle);
    };
    const emit = (type, detail) => clip.el.dispatchEvent(new CustomEvent(type, { detail }));
    Object.defineProperty(clip, 'handleSize', {
      get: () => handleSize,
      set: (v) => {
        handleSize = Math.max(0, Math.min(1, v));
        place();
      },
    });
    Object.defineProperty(clip, 'scrollValue', {
      get: () => scrollValue,
      set: (v) => {
        scrollValue = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
        place();
      },
    });
    const scrollTo = (v) => {
      clip.scrollValue = v;
      emit('scrolldrag', clip.scrollValue);
    };
    // Arrow buttons step once on click and repeat while held (INITIAL_DELAY, REPEAT_DELAY).
    const hold = (button, type) => {
      let timer = null;
      const stop = () => clearTimeout(timer);
      button.on('pointerdown', () => {
        emit(type);
        const repeat = (delay) => (timer = setTimeout(() => (emit(type), repeat(100)), delay));
        repeat(500);
      });
      button.on('pointerup', stop);
      button.on('pointerleave', stop);
    };
    hold(up, 'stepup');
    hold(down, 'stepdown');
    handle.el.style.cursor = 'pointer';
    handle.on('pointerdown', (event) => {
      event.stopPropagation();
      const grab = handle.y - clip.localPoint(event).y;
      const move = (e) => scrollTo((clip.localPoint(e).y + grab - background.y) / Math.max(1, background.height - handle.height));
      const release = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', release);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', release);
      ui.playSound('ClickShort');
    });
    background.el.style.cursor = 'pointer';
    background.on('pointerdown', (event) => {
      const y = clip.localPoint(event).y;
      scrollTo(scrollValue + (y < handle.y ? -0.1 : 0.1));
    });
    place();
  };
}

/** A list row MovieClip with Up/Over/Selected (or _up/_over/_down) frames. */
function listEntry(labels) {
  return (clip) => {
    clip.gotoAndStop(labels.up);
    clip.selected = false;
    clip.el.style.cursor = 'pointer';
    clip.el.classList.add('list-row');
    // This build's look: a rounded highlight (soft on hover, with a ring when
    // selected) where the original frames drew a square grey bar.
    let glow = null;
    const highlight = () => {
      if (glow) return;
      // The original selection bar (a shape stretched across the row), in the row's coordinates.
      clip.gotoAndStop(labels.selected);
      const bar = clip.children.find((c) => !c.box && !c.def?.frames && c.el.getBBox().width > 20);
      const b = bar?.el.getBBox();
      const box = b ? { x: bar.x + b.x * bar.scaleX, y: bar.y + b.y * bar.scaleY, width: b.width * bar.scaleX, height: b.height * bar.scaleY } : { x: 0, y: 0, width: 140, height: 16 };
      clip.gotoAndStop(labels.up);
      glow = document.createElementNS(SVGNS, 'rect');
      glow.setAttribute('class', 'row-glow');
      for (const [k, v] of Object.entries({ x: box.x + 1, y: box.y + 0.5, width: Math.max(0, box.width - 2), height: Math.max(0, box.height - 1), rx: 3 })) glow.setAttribute(k, v);
      clip.el.insertBefore(glow, clip.el.firstChild);
    };
    clip.on('pointerenter', () => (highlight(), clip.el.classList.add('is-hover')));
    clip.on('pointerleave', () => clip.el.classList.remove('is-hover'));
    clip.select = () => {
      highlight();
      clip.selected = true;
      clip.el.classList.add('is-selected');
    };
    clip.deselect = () => {
      clip.selected = false;
      clip.el.classList.remove('is-selected');
    };
  };
}

/**
 * CharacterBox: a rounded box (grey or gold outline) with a waiting animation
 * until a character picture (a canvas), nothing, or "unknown" is shown.
 */
function characterBox() {
  return (clip) => {
    const part = (name) => clip.getChildByName(name);
    for (const name of ['stencil', 'offset', 'unknownAnim']) if (part(name)) part(name).visible = false;
    const outline = part('outline');
    outline?.gotoAndStop(1);
    let picture = null;
    const reset = () => {
      if (part('waitingAnim')) part('waitingAnim').visible = false;
      if (part('unknownAnim')) part('unknownAnim').visible = false;
      picture?.remove();
      picture = null;
    };
    clip.useGoldOutline = () => outline?.gotoAndStop(2);
    clip.clear = reset;
    clip.unknown = () => {
      reset();
      if (part('unknownAnim')) part('unknownAnim').visible = true;
    };
    clip.drawCharacter = (canvas) => {
      reset();
      if (!canvas) return;
      picture = document.createElementNS('http://www.w3.org/2000/svg', 'image');
      picture.setAttribute('width', canvas.width);
      picture.setAttribute('height', canvas.height);
      picture.setAttribute('href', canvas.toDataURL());
      picture.style.imageRendering = 'pixelated'; // Bitmap.smoothing is off
      // Between the background and the outline, like the original's bitmap.
      const background = part('background');
      if (background) background.el.after(picture);
      else clip.content.prepend(picture);
    };
  };
}

/** Attach the widget classes to a library. ui.playSound(name) plays a UI sound. */
export function installWidgets(lib, ui) {
  Object.assign(lib.behaviors, {
    'MMOcha.lobby.TextButton': textButton(ui),
    'MMOcha.lobby.RoundLobbyButton': roundButton(ui),
    'MMOcha.lobby.LobbyButton': lobbyButton(ui),
    'MMOcha.lobby.LeftButton': lobbyButton(ui),
    'MMOcha.lobby.RightButton': lobbyButton(ui),
    'MMOcha.lobby.CloseTabButton': lobbyButton(ui),
    'MMOcha.lobby.OkButton': lobbyButton(ui),
    'MMOcha.lobby.TickBox': tickBox(ui),
    'MMOcha.lobby.OptionTickBox': tickBox(ui),
    'MMOcha.lobby.OptionSelector': optionSelector(ui),
    'MMOcha.lobby.ColorSelector': colorSelector(lib),
    'MMOcha.lobby.Slider': slider(ui),
    'MMOcha.lobby.OptionSlider': optionSlider(ui),
    'MMOcha.lobby.ScrollBar': scrollBar(ui),
    'MMOcha.lobby.GameBrowserEntry': listEntry({ up: 'Up', over: 'Over', selected: 'Selected' }),
    'MMOcha.lobby.UserDisplay': listEntry({ up: '_up', over: '_over', selected: '_down' }),
    'boxhead.ui.CharacterBox': characterBox(ui),
  });
}
