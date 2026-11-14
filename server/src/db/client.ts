import { drizzle } from "drizzle-orm/node-postgres";

import { getPool } from "./pool.js";

export const db = drizzle(getPool());
