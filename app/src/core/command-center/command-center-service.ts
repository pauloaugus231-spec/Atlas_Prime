import type { Logger } from "../../types/logger.js";
import { CommandCenterRenderer } from "./command-center-renderer.js";
import { CommandCenterSnapshotBuilder, type CommandCenterSnapshotDependencies } from "./command-center-snapshot.js";
import type { CommandCenterSnapshot } from "./command-center-types.js";

export class CommandCenterService {
  private readonly snapshotBuilder: CommandCenterSnapshotBuilder;
  private readonly renderer = new CommandCenterRenderer();

  constructor(deps: CommandCenterSnapshotDependencies, private readonly logger: Logger) {
    this.snapshotBuilder = new CommandCenterSnapshotBuilder(deps);
  }

  async getSnapshot(): Promise<CommandCenterSnapshot> {
    return this.snapshotBuilder.build();
  }

  async render(): Promise<string> {
    const snapshot = await this.getSnapshot();
    this.logger.debug("Rendered command center snapshot", {
      approvalsPending: snapshot.inboxes.approvalsPending,
      agendaTodayCount: snapshot.agenda.todayCount,
    });
    return this.renderer.render(snapshot);
  }
}
