import type { Connection } from "mysql2/promise";

export type AlertDbConfig = {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
};

export type SilenceResult = {
  matchedCount: number;
  affectedRows: number;
};

export function resolveDbConfig(pluginCfg: Record<string, unknown> | undefined): AlertDbConfig {
  const db = (pluginCfg?.db ?? {}) as Record<string, unknown>;
  return {
    host: stringOr(db.host, process.env.ALERT_DB_HOST, "127.0.0.1"),
    port: numberOr(db.port, process.env.ALERT_DB_PORT, 3306),
    user: stringOr(db.user, process.env.ALERT_DB_USER, "root"),
    password: stringOr(db.password, process.env.ALERT_DB_PASSWORD, ""),
    database: stringOr(db.database, process.env.ALERT_DB_NAME, ""),
  };
}

export function resolveDefaultMinutes(pluginCfg: Record<string, unknown> | undefined): number {
  const raw = (pluginCfg as Record<string, unknown> | undefined)?.defaultMinutes;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  return 1440;
}

export async function silenceAlerts(
  conn: Connection,
  minutes: number,
  dryRun: boolean,
): Promise<SilenceResult> {
  // Compute cutoff entirely in SQL to avoid JS→MySQL bigint parameter issues.
  // UNIX_TIMESTAMP() returns seconds; alert_time is milliseconds.
  const countSql = `
    SELECT COUNT(*) AS cnt FROM alert_records
    WHERE alert_time < (UNIX_TIMESTAMP() * 1000 - ? * 60 * 1000)
      AND status NOT IN ('已忽略', '已完成')`;

  const [countRows] = await conn.execute(countSql, [minutes]);
  const matchedCount = Number((countRows as Array<{ cnt: number }>)[0]?.cnt ?? 0);

  if (dryRun || matchedCount === 0) {
    return { matchedCount, affectedRows: 0 };
  }

  const updateSql = `
    UPDATE alert_records
    SET status = '已忽略', ignore_time = UNIX_TIMESTAMP() * 1000
    WHERE alert_time < (UNIX_TIMESTAMP() * 1000 - ? * 60 * 1000)
      AND status NOT IN ('已忽略', '已完成')`;

  const [result] = await conn.execute(updateSql, [minutes]);
  const affectedRows = (result as { affectedRows?: number }).affectedRows ?? 0;

  return { matchedCount, affectedRows };
}

function stringOr(primary: unknown, envVal: string | undefined, fallback: string): string {
  if (typeof primary === "string" && primary.trim()) return primary.trim();
  if (envVal?.trim()) return envVal.trim();
  return fallback;
}

function numberOr(primary: unknown, envVal: string | undefined, fallback: number): number {
  if (typeof primary === "number" && Number.isFinite(primary)) return primary;
  if (envVal?.trim()) {
    const n = Number(envVal.trim());
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}
