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
    addButtonApi(button, ui, { disabledColor: ROUND_DISABLED });
  };
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
      if (valueField) valueField.text = String(options[i] ?? '');
      if (notify) clip.el.dispatchEvent(new Event('change'));
    };
    left?.onClick?.(() => index > 0 && select(index - 1));
    right?.onClick?.(() => index < options.length - 1 && select(index + 1));
    clip.displayOptions = (name, list, selected) => {
      options = list || [];
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
    const place = () => {
      handle.scaleY = Math.max(0.05, (background.height * handleSize) / handleNatural);
      handle.y = background.y + scrollValue * (background.height - handle.height);
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
    clip.on('pointerenter', () => !clip.selected && clip.gotoAndStop(labels.over));
    clip.on('pointerleave', () => !clip.selected && clip.gotoAndStop(labels.up));
    clip.select = () => {
      clip.selected = true;
      clip.gotoAndStop(labels.selected);
    };
    clip.deselect = () => {
      clip.selected = false;
      clip.gotoAndStop(labels.up);
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
    'MMOcha.lobby.Slider': slider(ui),
    'MMOcha.lobby.OptionSlider': optionSlider(ui),
    'MMOcha.lobby.ScrollBar': scrollBar(ui),
    'MMOcha.lobby.GameBrowserEntry': listEntry({ up: 'Up', over: 'Over', selected: 'Selected' }),
    'MMOcha.lobby.UserDisplay': listEntry({ up: '_up', over: '_over', selected: '_down' }),
    'boxhead.ui.CharacterBox': characterBox(ui),
  });
}
