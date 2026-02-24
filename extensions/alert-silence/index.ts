import { createAlertSilenceTool } from "./src/tool.js";

export default function register(api: Record<string, any>) {
  const pluginCfg = (api.pluginConfig ?? {}) as Record<string, unknown>;
  api.registerTool(createAlertSilenceTool(pluginCfg));
}
