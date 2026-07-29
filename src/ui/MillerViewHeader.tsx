import type { JSX, ReactNode } from "react";

type MillerViewMode = "columns" | "tree";

interface MillerViewHeaderProps {
  mode: MillerViewMode;
  onToggleView?: () => void;
  controls?: ReactNode;
}

export function MillerViewHeader({
  mode,
  onToggleView,
  controls,
}: MillerViewHeaderProps): JSX.Element {
  const toggleLabel =
    mode === "columns" ? "Show task tree" : "Show Miller columns";

  return (
    <header className="miller-view-header">
      <button
        className="miller-view-toggle"
        type="button"
        aria-label={toggleLabel}
        title={toggleLabel}
        onClick={onToggleView}
      >
        {mode === "columns" ? <TreeIcon /> : <ColumnsIcon />}
      </button>
      <h1>Miller Tasks</h1>
      {controls ? (
        <div className="miller-view-header-controls">{controls}</div>
      ) : null}
    </header>
  );
}

function TreeIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4v5m0 0H6a2 2 0 0 0-2 2v5m8-7h6a2 2 0 0 1 2 2v5" />
      <circle cx="4" cy="19" r="2" />
      <circle cx="12" cy="4" r="2" />
      <circle cx="20" cy="19" r="2" />
    </svg>
  );
}

function ColumnsIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="4" width="5" height="16" rx="1" />
      <rect x="10" y="4" width="5" height="16" rx="1" />
      <rect x="17" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}
