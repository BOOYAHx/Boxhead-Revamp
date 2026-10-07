/** Minimal event emitter (no DOM dependency, so it also runs under Node tests). */
export class Emitter {
  constructor() {
    this.listeners = new Map();
  }

  on(type, listener) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(listener);
    return () => this.off(type, listener);
  }

  off(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type, detail = {}) {
    for (const listener of [...(this.listeners.get(type) || [])]) listener(detail);
  }
}
