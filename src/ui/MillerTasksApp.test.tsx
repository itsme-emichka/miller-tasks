import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MillerTasksApp } from "./MillerTasksApp";

describe("MillerTasksApp", () => {
  it("renders the task browser foundation", () => {
    render(<MillerTasksApp />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Miller Tasks" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Tasks" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("complementary", { name: "Task details" }),
    ).toBeInTheDocument();
  });

  it("explains the empty hierarchy state", () => {
    render(<MillerTasksApp />);

    expect(
      screen.getByText("Your task tree starts here"),
    ).toBeVisible();
    expect(
      screen.getByText("Select a task to open its next level."),
    ).toBeVisible();
  });
});
