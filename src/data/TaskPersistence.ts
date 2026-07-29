import { parseOrMigratePluginDataV3 } from "../sync/parseSyncData";
import {
  clonePluginDataV3,
  PluginDataV3,
} from "../sync/syncData";

type LoadRawData = () => Promise<unknown>;
type SaveRawData = (data: PluginDataV3) => Promise<void>;

export class TaskPersistence {
  private queue: Promise<void> = Promise.resolve();
  private latestSave: Promise<void> = Promise.resolve();

  constructor(
    private readonly loadRawData: LoadRawData,
    private readonly saveRawData: SaveRawData,
  ) {}

  async load(): Promise<PluginDataV3> {
    return parseOrMigratePluginDataV3(await this.loadRawData());
  }

  save(data: PluginDataV3): Promise<void> {
    const snapshot = clonePluginDataV3(data);
    const save = this.queue.then(() => this.saveRawData(snapshot));

    this.latestSave = save;
    this.queue = save.catch(() => undefined);
    return save;
  }

  async flush(): Promise<void> {
    await this.latestSave;
  }
}
