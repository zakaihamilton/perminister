// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PreviewGuard } from "@/app/ui-preview/preview-guard";

describe("UI preview guard", () => {
  it("stops production submit handlers before they can send a request", () => {
    const submit = vi.fn((event) => event.preventDefault());
    render(
      <PreviewGuard>
        <form onSubmit={submit}>
          <button type="submit">Save</button>
        </form>
      </PreviewGuard>,
    );
    fireEvent.submit(screen.getByRole("button", { name: "Save" }).closest("form")!);
    expect(submit).not.toHaveBeenCalled();
  });
  it("stops dashboard link handlers but permits scenario links", () => {
    const dashboardClick = vi.fn((event) => event.preventDefault());
    const scenarioClick = vi.fn((event) => event.preventDefault());
    render(
      <PreviewGuard>
        <a href="/example-blocked" onClick={dashboardClick}>
          Dashboard
        </a>
        <div className="ui-preview-toolbar">
          <a href="/ui-preview?scenario=empty" onClick={scenarioClick}>
            Empty
          </a>
        </div>
      </PreviewGuard>,
    );
    fireEvent.click(screen.getByRole("link", { name: "Dashboard" }));
    expect(
      fireEvent(
        screen.getByRole("link", { name: "Dashboard" }),
        new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 }),
      ),
    ).toBe(false);
    expect(fireEvent.contextMenu(screen.getByRole("link", { name: "Dashboard" }))).toBe(false);
    expect(fireEvent.contextMenu(screen.getByRole("link", { name: "Empty" }))).toBe(true);
    fireEvent.click(screen.getByRole("link", { name: "Empty" }));
    expect(dashboardClick).not.toHaveBeenCalled();
    expect(scenarioClick).toHaveBeenCalledOnce();
  });
});
