// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { DeveloperGuideNav } from "@/components/site-shell";

describe("developer guide navigation", () => {
  it("moves through navigation links with the keyboard", async () => {
    const user = userEvent.setup();
    render(<DeveloperGuideNav active="overview" />);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("link", {name:"Overview"}));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("link", {name:"Getting started"}));
  });
});
