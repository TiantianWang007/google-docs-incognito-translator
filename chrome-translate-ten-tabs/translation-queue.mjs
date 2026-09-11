export function createTranslationQueue({ translate, onStart, onResult, onChange, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), interval = 2000 }) {
  let current;
  async function pump(job) {
    if (!job?.active || job.running) return;
    job.running = true;
    try {
      while (job.active && current === job && job.index < job.items.length) {
        const row = job.items[job.index];
        if (["waiting", "loading", "pending"].includes(row.state)) return;
        if (row.state !== "loaded") { job.index++; continue; }
        onStart(row);
        let result;
        try { result = await translate(row); }
        catch (error) { result = { ok: false, uncertain: true, error: error.message }; }
        if (current !== job) return;
        onResult(row, result);
        job.index++;
        if (job.active && job.index < job.items.length) await wait(interval);
      }
      if (job.index >= job.items.length) job.active = false;
    } finally { job.running = false; onChange(); }
  }
  return {
    get active() { return Boolean(current?.active); },
    get running() { return Boolean(current?.running); },
    start(items) {
      if (current) current.active = false;
      current = { items: [...items], index: 0, active: true, running: false };
      onChange(); void pump(current);
    },
    kick() { void pump(current); },
    stop() { if (current) current.active = false; onChange(); }
  };
}
