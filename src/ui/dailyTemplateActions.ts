export interface DailyTemplateActions {
  deleteTemplate: (templateId: string, title: string) => Promise<void>;
}
