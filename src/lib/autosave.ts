export type SaveOutcome =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

export type AutosaveStatus = "idle" | "blocked" | "pending" | "saving" | "saved" | "error";

export type AutosaveState = {
  status: AutosaveStatus;
  error?: string;
  fieldErrors?: Record<string, string>;
};

export type Timers = {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
};

export const NETWORK_ERROR =
  "Couldn't reach the server, so your changes aren't saved yet. Check your connection and retry.";

const defaultTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export type AutosaverOptions<V> = {
  save: (value: V) => Promise<SaveOutcome>;
  onState: (state: AutosaveState) => void;
  initial: V;
  /** True when `initial` is already persisted (editing an existing entry). */
  persisted: boolean;
  canSave?: (value: V) => boolean;
  delayMs?: number;
  timers?: Timers;
};

/**
 * Debounced, serialized autosave. At most one save runs at a time; edits made
 * during a save are saved right after it with the latest value. A thrown save
 * (offline, server unreachable) becomes an error state the UI shows as a toast.
 */
export function createAutosaver<V>(opts: AutosaverOptions<V>) {
  const { save, onState, canSave = () => true, delayMs = 800, timers = defaultTimers } = opts;
  let latest = opts.initial;
  let lastSaved = opts.persisted ? JSON.stringify(opts.initial) : null;
  let timer: unknown = null;
  let inFlight: Promise<void> | null = null;
  let queued = false;
  let disposed = false;

  const emit = (state: AutosaveState) => {
    if (!disposed) onState(state);
  };

  const cancelTimer = () => {
    if (timer !== null) {
      timers.clear(timer);
      timer = null;
    }
  };

  async function attempt(value: V, key: string) {
    emit({ status: "saving" });
    let outcome: SaveOutcome;
    try {
      outcome = await save(value);
    } catch {
      outcome = { ok: false, error: NETWORK_ERROR };
    }
    inFlight = null;
    if (outcome.ok) lastSaved = key;
    if (queued) {
      queued = false;
      await run();
      return;
    }
    emit(
      outcome.ok
        ? { status: "saved" }
        : { status: "error", error: outcome.error, fieldErrors: outcome.fieldErrors },
    );
  }

  function run(): Promise<void> {
    if (inFlight) {
      queued = true;
      return inFlight;
    }
    if (!canSave(latest)) {
      emit({ status: "blocked" });
      return Promise.resolve();
    }
    const key = JSON.stringify(latest);
    if (key === lastSaved) {
      emit({ status: "saved" });
      return Promise.resolve();
    }
    inFlight = attempt(latest, key);
    return inFlight;
  }

  return {
    schedule(value: V) {
      latest = value;
      cancelTimer();
      if (!canSave(value)) {
        emit({ status: "blocked" });
        return;
      }
      emit({ status: "pending" });
      timer = timers.set(() => {
        timer = null;
        void run();
      }, delayMs);
    },
    flush() {
      cancelTimer();
      return run();
    },
    dispose() {
      disposed = true;
      cancelTimer();
    },
  };
}

export type Autosaver<V> = ReturnType<typeof createAutosaver<V>>;
