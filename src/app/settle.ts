// PF-1's end point (QA-LOG Q-028): a timing runs until the first frame showing the result
// has painted and no main-thread task longer than 50 ms is running, measured as the end
// of the last long task after the second frame, or the second frame itself if no long
// task follows within 100 ms. Animation-frame callbacks alone miss work WebKitGTK does
// after them (a ~500 ms stall after a 1 MB open came before or after the second callback
// by chance). Long tasks are seen as gaps of more than 50 ms between chained timers.

/** After `frames` animation frames: `frame`, the time of the last of them, and `end`, the
 * end of the last long task starting within 100 ms of it (or `frame`). */
export function settled(frames = 2): Promise<{ frame: number; end: number }> {
  return new Promise((resolve) => {
    const watch = () => {
      const frame = performance.now();
      let end = frame;
      let prev = frame;
      const tick = () => {
        const now = performance.now();
        if (now - prev > 50 && prev - frame <= 100) end = now;
        prev = now;
        if (now - frame > 100) resolve({ frame, end });
        else window.setTimeout(tick, 0);
      };
      window.setTimeout(tick, 0);
    };
    const step = (n: number) => (n ? requestAnimationFrame(() => step(n - 1)) : watch());
    step(frames);
  });
}
