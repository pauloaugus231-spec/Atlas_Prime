import type { AppConfig } from "../../types/config.js";
import type { Logger } from "../../types/logger.js";
import { createDeclaredCapabilityCatalog } from "../capabilities/catalog.js";
import { createBuiltInCapabilities } from "../capabilities/index.js";
import { CapabilityRegistry } from "../capability-registry.js";
import { loadToolPlugins } from "../plugin-loader.js";
import { ToolPluginRegistry } from "../plugin-registry.js";
import type { PluginLayer } from "./types.js";

export async function createPluginLayer(config: AppConfig, logger: Logger, pluginLogger: Logger): Promise<PluginLayer> {
  const loadedPlugins = await loadToolPlugins(
    [
      {
        dir: config.paths.pluginsDir,
        origin: "external",
      },
      {
        dir: config.paths.builtInPluginsDir,
        origin: "builtin",
      },
    ],
    pluginLogger,
  );

  const registry = new ToolPluginRegistry(loadedPlugins, logger.child({ scope: "tool-registry" }));
  const capabilityRegistry = new CapabilityRegistry(
    registry,
    createBuiltInCapabilities(),
    createDeclaredCapabilityCatalog(),
    logger.child({ scope: "capability-registry" }),
  );

  return {
    loadedPlugins,
    registry,
    capabilityRegistry,
  };
}
