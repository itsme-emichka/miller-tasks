import { App, ButtonComponent, Modal } from "obsidian";

interface ConfirmationOptions {
  title: string;
  message: string;
  confirmLabel: string;
}

export function requestConfirmation(
  app: App,
  options: ConfirmationOptions,
): Promise<boolean> {
  return new Promise((resolve) => {
    new ConfirmationModal(app, options, resolve).open();
  });
}

class ConfirmationModal extends Modal {
  private settled = false;

  constructor(
    app: App,
    private readonly options: ConfirmationOptions,
    private readonly resolve: (confirmed: boolean) => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.setTitle(this.options.title);
    this.contentEl.createEl("p", { text: this.options.message });
    const actions = this.contentEl.createDiv({
      cls: "miller-task-confirm-actions",
    });

    new ButtonComponent(actions)
      .setButtonText("Cancel")
      .onClick(() => this.finish(false));
    new ButtonComponent(actions)
      .setButtonText(this.options.confirmLabel)
      .setCta()
      .onClick(() => this.finish(true));
  }

  override onClose(): void {
    this.contentEl.empty();
    if (!this.settled) {
      this.settled = true;
      this.resolve(false);
    }
  }

  private finish(confirmed: boolean): void {
    if (this.settled) {
      return;
    }
    this.settled = true;
    this.resolve(confirmed);
    this.close();
  }
}
