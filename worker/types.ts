import type { Db } from "./db";

export type AppEnv = { Bindings: Env; Variables: { db: Db } };
