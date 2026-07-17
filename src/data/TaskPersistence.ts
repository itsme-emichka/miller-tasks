import {
  clonePluginData,
  parsePluginData,
} from "../domain/pluginData";
import { PluginData } from "../domain/task";

type LoadRawData = () => Promise<unknown>;
type SaveRawData = (data: PluginData) => Promise<void>;

export class TaskPersistence {
  private queue: Promise<void> = Promise.resolve();
  private latestSave: Promise<void> = Promise.resolve();

  constructor(
    private readonly loadRawData: LoadRawData,
    private readonly saveRawData: SaveRawData,
  ) {}

  async load(): Promise<PluginData> {
    return parsePluginData(await this.loadRawData());
  }

  save(data: PluginData): Promise<void> {
    const snapshot = clonePluginData(data);
    const save = this.queue.then(() => this.saveRawData(snapshot));

    this.latestSave = save;
    this.queue = save.catch(() => undefined);
    return save;
  }

  async flush(): Promise<void> {
    await this.latestSave;
  }
}
