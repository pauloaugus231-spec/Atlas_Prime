import { createAutonomyLayer } from "./composition/create-autonomy-layer.js";
import { createBootstrapLayer } from "./composition/create-bootstrap-layer.js";
import { createIntelligenceLayer } from "./composition/create-intelligence-layer.js";
import { createIntegrationsLayer } from "./composition/create-integrations-layer.js";
import { createLlmLayer } from "./composition/create-llm-layer.js";
import { createOsLayer } from "./composition/create-os-layer.js";
import { createPluginLayer } from "./composition/create-plugin-layer.js";
import { createRuntimeLayer } from "./composition/create-runtime-layer.js";
import { createStorageLayer } from "./composition/create-storage-layer.js";
import type { CreateAgentCoreResult } from "./composition/types.js";

export async function createAgentCore(): Promise<CreateAgentCoreResult> {
  const bootstrap = createBootstrapLayer();
  const storage = createStorageLayer(bootstrap.config, bootstrap.logger);
  const autonomy = createAutonomyLayer(bootstrap.config, bootstrap.logger, storage);
  const intelligence = createIntelligenceLayer(bootstrap, storage);
  const integrations = createIntegrationsLayer(bootstrap.config, bootstrap.logger, storage, intelligence);
  const llm = createLlmLayer(bootstrap.config, bootstrap.logger);
  const os = createOsLayer(bootstrap.config, bootstrap.logger, storage, autonomy, intelligence, integrations);
  const plugins = await createPluginLayer(bootstrap.config, bootstrap.logger, bootstrap.pluginLogger);
  const runtime = createRuntimeLayer({
    bootstrap,
    storage,
    autonomy,
    intelligence,
    integrations,
    llm,
    plugins,
    os,
  });

  return {
    ...bootstrap,
    ...storage,
    ...autonomy,
    ...intelligence,
    ...integrations,
    ...llm,
    ...plugins,
    ...os,
    ...runtime,
  };
}
