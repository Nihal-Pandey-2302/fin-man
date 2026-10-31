// Per-device conveniences only (last-used account, category usage). Never source-of-truth data.
export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`fintrack.${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown) {
  try {
    localStorage.setItem(`fintrack.${key}`, JSON.stringify(value));
  } catch {
    // storage unavailable (private mode): ignore
  }
}
