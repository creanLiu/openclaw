import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { createAlertSilenceTool } from "./src/tool.js";

export default function register(api: OpenClawPluginApi) {
  const pluginCfg = (api.pluginConfig ?? {}) as Record<string, unknown>;
  api.registerTool(createAlertSilenceTool(pluginCfg));
}
