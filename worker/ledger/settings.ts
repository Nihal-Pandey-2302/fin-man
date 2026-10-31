import { eq } from "drizzle-orm";
import type { Db } from "../db";
import { settings } from "../db/schema";

/** Known settings and their defaults. Values are stored as JSON. */
export const SETTING_DEFAULTS = {
  /** Your own name as banks print it (used to recognise transfers between your accounts). */
  owner_names: [] as string[],
  /** Money kept aside in bank balances; shown as "free after buffer". */
  liquid_buffer_paise: 0,
  /** Salary detection (Phase 2): employer name fragment and minimum amount. */
  salary_employer: "",
  salary_min_paise: 0,
};
export type Settings = typeof SETTING_DEFAULTS;
export type SettingKey = keyof Settings;

export async function getSettings(db: Db): Promise<Settings> {
  const rows = await db.select().from(settings);
  const out: Record<string, unknown> = { ...SETTING_DEFAULTS };
  for (const row of rows) {
    if (row.key in SETTING_DEFAULTS) {
      try {
        out[row.key] = JSON.parse(row.value);
      } catch {
        // keep default for a corrupt value
      }
    }
  }
  return out as Settings;
}

export async function getSetting<K extends SettingKey>(db: Db, key: K): Promise<Settings[K]> {
  const row = await db.select().from(settings).where(eq(settings.key, key)).get();
  if (!row) return SETTING_DEFAULTS[key];
  try {
    return JSON.parse(row.value) as Settings[K];
  } catch {
    return SETTING_DEFAULTS[key];
  }
}

export async function setSetting<K extends SettingKey>(db: Db, key: K, value: Settings[K]) {
  const json = JSON.stringify(value);
  await db.insert(settings).values({ key, value: json }).onConflictDoUpdate({ target: settings.key, set: { value: json } });
}
