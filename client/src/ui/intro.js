// The original's opening (MainFactory's preloader and boxhead.ui.Intros):
// the white BOXHEAD Bounty Hunter screen with its loading bar while the game
// loads, then a dark red veil drops over it (MainFactory.loadComplete), the
// screen fades to black over 38 frames and back out over 27 onto the main
// menu. The Sean Cooper and XGen logos that played in the black are left out.
// The art comes from BBH.swf (tools/build_assets.py exports it to intro/);
// without it the boot screen keeps its plain loading bar.

import { FlashLibrary, Stage } from './flash.js';

const BASE = 'assets/game/intro/';
const VERSION = 'Version 1.00'; // MainFactory: "Version " + Constants.VERSION (100)
const FRAME = 1000 / 30; // BBH.swf runs at 30 frames a second
const TO_BLACK = 38 * FRAME; // Intros: up to the "Black" label
const FROM_BLACK = 27 * FRAME; // and the rest of its timeline
const VEIL = 'rgba(68, 0, 0, 0.92)'; // MainFactory.loadComplete: beginFill(0x440000, 0.92)
// The bar's fill is a shape tween the export leaves out; its last frame's full
// fill (shape 8, from x = -320 to 320) is stretched to the progress instead.
const FULL_FILL = 8;
const FILL_LEFT = -320;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export class Intro {
  constructor(container) {
    this.root = document.createElement('div');
    this.root.id = 'intro';
    container.appendChild(this.root);
    this.bar = null;
    this.failed = false;
    this.ready = this.build();
  }

  async build() {
    try {
      const lib = await FlashLibrary.load(BASE, 'intro-');
      // The logo is a small bitmap the original drew unsmoothed; stretched to a large
      // window that turns its edges blocky, so it is smoothed here.
      for (const image of lib.defs.querySelectorAll('image')) image.style.imageRendering = 'auto';
      const frame = document.createElement('div');
      frame.className = 'flash-stage';
      this.root.appendChild(frame);
      const stage = new Stage(frame);
      const screen = stage.addChild(lib.create('MainFactory_Preloader'));
      this.bar = screen.child('bar');
      this.bar?.gotoAndStop(1);
      if (this.bar) {
        this.fill = lib.create(FULL_FILL);
        this.bar.content.insertBefore(this.fill.el, this.bar.content.children[1] || null);
      }
      const loading = screen.child('loadingField');
      if (loading) loading.text = '';
      const version = screen.child('versionField');
      if (version) version.text = VERSION;
    } catch (error) {
      console.warn('Intro art not found (run tools/build_assets.py), using the plain loading bar:', error.message);
      this.failed = true;
      this.root.remove();
    }
    return !this.failed;
  }

  /** MainFactory.drawBar: 0..1 of the game loaded. */
  progress(value) {
    if (!this.fill) return;
    const p = Math.max(0, Math.min(1, value));
    this.fill.scaleX = p;
    this.fill.x = FILL_LEFT * (1 - p);
  }

  /** Loaded: the veil, then the fade to black. */
  async toBlack() {
    if (this.failed) return;
    this.fill?.el.remove();
    this.bar?.gotoAndStop(this.bar.totalFrames); // the full bar and "LOADED!"
    const veil = document.createElement('div');
    veil.className = 'intro-veil';
    veil.style.background = VEIL;
    this.black = document.createElement('div');
    this.black.className = 'intro-veil';
    this.black.style.background = '#000';
    this.black.style.opacity = '0';
    this.root.append(veil, this.black);
    await this.fade(this.black, 0, 1, TO_BLACK);
  }

  /** The menu is underneath now: fade the black away and leave. */
  async reveal() {
    if (this.failed) return;
    this.root.style.background = 'transparent';
    for (const child of [...this.root.children]) if (child !== this.black) child.remove();
    await this.fade(this.black, 1, 0, FROM_BLACK);
    this.root.remove();
  }

  fade(el, from, to, ms) {
    return new Promise((resolve) => {
      const start = performance.now();
      const step = (now) => {
        const t = Math.max(0, Math.min(1, (now - start) / ms));
        el.style.opacity = String(from + (to - from) * t);
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
      wait(ms + 500).then(resolve); // a hidden tab gets no animation frames
    });
  }
}
