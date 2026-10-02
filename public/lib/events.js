// A tiny event emitter: the player announces what happens (a section starts, the song changes, play / pause /
// stop, the song list changes) and the panels react, instead of each checking on a timer.

export function createEmitter() {
  const handlers = new Map(); // event → Set(fn)
  return {
    /** Listen to an event ('*' hears every event as fn(event, data)). Returns a function that stops listening. */
    on(event, fn) {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event).add(fn);
      return () => handlers.get(event)?.delete(fn);
    },
    emit(event, data) {
      for (const fn of [...(handlers.get(event) || [])]) {
        try { fn(data); } catch (e) { console.error(`[${event} listener]`, e); }
      }
      for (const fn of [...(handlers.get('*') || [])]) {
        try { fn(event, data); } catch (e) { console.error(`[* listener]`, e); }
      }
    },
  };
}

/** Run fn at most once per animation frame however often it's asked for (falls back to a timer outside a browser). */
export function onceAFrame(fn) {
  let queued = false;
  const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (f) => setTimeout(f, 16);
  return () => {
    if (queued) return;
    queued = true;
    raf(() => { queued = false; fn(); });
  };
}
