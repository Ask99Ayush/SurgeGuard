import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RangeSelect } from "@/components/admin/RangeSelect";
import { StatTile } from "@/components/admin/StatTile";
import { ConfirmDialog } from "./ConfirmDialog";
import { StateView } from "./StateView";
import { ThemeToggle } from "./ThemeToggle";

describe("StateView", () => {
  it.each([
    ["loading", "status"],
    ["empty", "status"],
    ["error", "alert"],
    ["disconnected", "alert"],
  ] as const)("renders %s with role %s", (kind, role) => {
    render(<StateView kind={kind} />);
    expect(screen.getByRole(role)).toHaveAttribute("data-state", kind);
  });

  it("offers a retry action for errors", async () => {
    const onRetry = vi.fn();
    render(<StateView kind="error" onRetry={onRetry} />);
    await userEvent.click(screen.getByRole("button", { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });
});

describe("StatTile", () => {
  it("renders an explicit unavailable state with its reason, never a zero", () => {
    render(<StatTile label="Origin error rate" value={null} context="Prometheus unreachable" />);
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    expect(screen.getByText("Prometheus unreachable")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
  it("renders a value with one line of context", () => {
    render(<StatTile label="Queue length" value="1,204" context="Visitors waiting now" />);
    expect(screen.getByText("1,204")).toBeInTheDocument();
    expect(screen.getByText("Visitors waiting now")).toBeInTheDocument();
  });
  it("keeps zero neutral and colours only real problems", () => {
    const { rerender } = render(<StatTile label="Queue length" value="0" context="x" />);
    expect(screen.getByText("0").className).not.toMatch(/text-danger|text-warning/);
    rerender(<StatTile label="Origin error rate" value="12.0%" context="x" emphasis="danger" />);
    expect(screen.getByText("12.0%").className).toMatch(/text-danger/);
  });
  it("supports a custom empty label for no-data cases", () => {
    render(<StatTile label="Origin error rate" value={null} emptyLabel="No traffic" context="No origin requests" />);
    expect(screen.getByText("No traffic")).toBeInTheDocument();
  });
});

describe("ConfirmDialog", () => {
  it("is an accessible alertdialog that focuses Cancel and closes on Escape", () => {
    const onCancel = vi.fn();
    render(
      <ConfirmDialog open title="Pause admission?" description="desc" confirmLabel="Pause" onConfirm={vi.fn()} onCancel={onCancel} />,
    );
    const dialog = screen.getByRole("alertdialog", { name: "Pause admission?" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });

  it("confirms", async () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog open title="T" description="d" confirmLabel="Do it" onConfirm={onConfirm} onCancel={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "Do it" }));
    expect(onConfirm).toHaveBeenCalled();
  });

  it("renders nothing when closed", () => {
    render(<ConfirmDialog open={false} title="T" description="d" confirmLabel="x" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});

describe("RangeSelect", () => {
  it("is a keyboard-operable radiogroup", () => {
    const onChange = vi.fn();
    render(<RangeSelect value="1h" onChange={onChange} />);
    const current = screen.getByRole("radio", { name: "1h" });
    expect(current).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(current, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("6h");
  });
});

describe("ThemeToggle", () => {
  it("renders light and dark theme buttons and allows switching between them", async () => {
    render(<ThemeToggle />);
    const group = screen.getByRole("group", { name: /color theme/i });
    expect(group).toBeInTheDocument();

    const lightBtn = screen.getByTitle("Light theme");
    const darkBtn = screen.getByTitle("Dark theme");

    expect(lightBtn).toBeInTheDocument();
    expect(darkBtn).toBeInTheDocument();
    expect(screen.queryByTitle("System theme")).not.toBeInTheDocument();

    await userEvent.click(lightBtn);
    expect(lightBtn).toHaveAttribute("aria-pressed", "true");
    expect(localStorage.getItem("surgeguard-theme")).toBe("light");

    await userEvent.click(darkBtn);
    expect(darkBtn).toHaveAttribute("aria-pressed", "true");
    expect(localStorage.getItem("surgeguard-theme")).toBe("dark");
  });
});
