import { createConnection } from "mysql2/promise";
import { resolveDbConfig, resolveDefaultMinutes, silenceAlerts } from "./db.js";

export type AlertSilencePluginConfig = Record<string, unknown> | undefined;

// Plain JSON Schema — avoids runtime dependency on @sinclair/typebox
const AlertSilenceSchema = {
  type: "object" as const,
  properties: {
    minutes: {
      type: "number" as const,
      description:
        "Time window in minutes. Alerts with alert_time older than now minus this value will be silenced. Defaults to config value (1440).",
      minimum: 1,
    },
    dry_run: {
      type: "boolean" as const,
      description: "Preview mode: count matching alerts without modifying them.",
    },
  },
};

export function createAlertSilenceTool(pluginCfg: AlertSilencePluginConfig) {
  const defaultMinutes = resolveDefaultMinutes(pluginCfg);

  return {
    name: "alert_silence",
    label: "Alert Silence",
    description: `Batch-silence stale alerts in MySQL. Updates alert_records where alert_time is older than the specified window (default: ${defaultMinutes} minutes) to status='已忽略'.`,
    parameters: AlertSilenceSchema,
    execute: async (_toolCallId: string, args: unknown) => {
      const params = (args ?? {}) as Record<string, unknown>;
      const minutes =
        typeof params.minutes === "number" && Number.isFinite(params.minutes) && params.minutes > 0
          ? Math.floor(params.minutes)
          : defaultMinutes;
      const dryRun = params.dry_run === true;

      const dbCfg = resolveDbConfig(pluginCfg);
      if (!dbCfg.database) {
        return {
          type: "json" as const,
          content: {
            status: "error",
            error:
              "Database not configured. Set plugins.entries.alert-silence.config.db in ~/.openclaw/openclaw.json or ALERT_DB_NAME env var.",
          },
        };
      }

      let conn;
      try {
        conn = await createConnection({
          host: dbCfg.host,
          port: dbCfg.port,
          user: dbCfg.user,
          password: dbCfg.password,
          database: dbCfg.database,
          connectTimeout: 10_000,
        });

        const result = await silenceAlerts(conn, minutes, dryRun);

        return {
          type: "json" as const,
          content: {
            status: "ok",
            dry_run: dryRun,
            minutes,
            matched_count: result.matchedCount,
            affected_rows: result.affectedRows,
            message: dryRun
              ? `[预览] 发现 ${result.matchedCount} 条超过 ${minutes} 分钟的待处理告警`
              : result.affectedRows > 0
                ? `已静默 ${result.affectedRows} 条超过 ${minutes} 分钟的告警`
                : `没有需要静默的超时告警（窗口: ${minutes} 分钟）`,
          },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { type: "json" as const, content: { status: "error", error: `Database error: ${msg}` } };
      } finally {
        await conn?.end().catch(() => {});
      }
    },
  };
}
