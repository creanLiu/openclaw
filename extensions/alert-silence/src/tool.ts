import { createConnection } from "mysql2/promise";
import { Type } from "@sinclair/typebox";
import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import { resolveDbConfig, resolveDefaultMinutes, silenceAlerts } from "./db.js";

export type AlertSilencePluginConfig = Record<string, unknown> | undefined;

const AlertSilenceSchema = Type.Object({
  minutes: Type.Optional(
    Type.Number({
      description:
        "Time window in minutes. Alerts with alert_time older than now minus this value will be silenced. Defaults to config value (1440).",
      minimum: 1,
    }),
  ),
  dry_run: Type.Optional(
    Type.Boolean({
      description: "Preview mode: count matching alerts without modifying them.",
    }),
  ),
});

export function createAlertSilenceTool(pluginCfg: AlertSilencePluginConfig) {
  const defaultMinutes = resolveDefaultMinutes(pluginCfg);

  return {
    name: "alert_silence",
    label: "Alert Silence",
    description: `Batch-silence stale alerts in MySQL. Updates alert_records where alert_time is older than the specified window (default: ${defaultMinutes} minutes) to status='已忽略'.`,
    parameters: AlertSilenceSchema,
    execute: async (
      _toolCallId: string,
      args: unknown,
    ): Promise<AgentToolResult<unknown>> => {
      const params = (args ?? {}) as Record<string, unknown>;
      const minutes =
        typeof params.minutes === "number" && Number.isFinite(params.minutes) && params.minutes > 0
          ? Math.floor(params.minutes)
          : defaultMinutes;
      const dryRun = params.dry_run === true;

      const dbCfg = resolveDbConfig(pluginCfg);
      if (!dbCfg.database) {
        return jsonResult({
          status: "error",
          error:
            "Database not configured. Set skills.entries.alert-silence.db in ~/.openclaw/openclaw.json or ALERT_DB_NAME env var.",
        });
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

        return jsonResult({
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
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return jsonResult({ status: "error", error: `Database error: ${msg}` });
      } finally {
        await conn?.end().catch(() => {});
      }
    },
  };
}

function jsonResult(data: Record<string, unknown>): AgentToolResult<unknown> {
  return { type: "json", content: data };
}
