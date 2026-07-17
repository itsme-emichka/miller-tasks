import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MillerTasksApp } from "./MillerTasksApp";

describe("MillerTasksApp", () => {
  it("renders one shared heading above unlabelled visual columns", () => {
    const { container } = render(<MillerTasksApp />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Miller Tasks" }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("heading")).toHaveLength(1);
    expect(
      container.querySelectorAll(".miller-tasks-column"),
    ).toHaveLength(2);
  });

  it("keeps status, path, column headers, and inspector out of the main view", () => {
    const { container } = render(<MillerTasksApp />);

    expect(container.querySelector(".miller-tasks-toolbar")).toBeNull();
    expect(container.querySelector(".miller-tasks-path")).toBeNull();
    expect(container.querySelector(".miller-tasks-column-header")).toBeNull();
    expect(container.querySelector(".miller-tasks-inspector")).toBeNull();
  });
});
