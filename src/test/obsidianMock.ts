export class TFile {
  path = "";
  name = "";
}

export class TFolder {
  path = "";
  name = "";
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+/g, "/");
}
