// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

vi.mock("@/components/site-shell", () => ({ Brand: () => null, SiteHeader: () => null, SiteFooter: () => null }));
vi.mock("@/components/theme-control", () => ({ ThemeControl: () => null }));

import { AuthorizationView } from "@/components/authorization-view";
import { InvitationView } from "@/components/invitation-view";

describe("authorization and invitation views", () => {
  it("does not render a separate authorization confirmation step", () => {
    render(<AuthorizationView error="" />);
    expect(screen.getByRole("heading", { name: "Sign-in request unavailable" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Continue to/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("invalid or expired");
  });
  it("shows a useful error if Perminister cannot issue the authorization code", () => {
    render(<AuthorizationView error="unavailable" />);
    expect(screen.getByRole("heading", { name: "Sign-in temporarily unavailable" })).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("Return to the product and try again");
  });
  it("renders the signed-in invitation form and preserves its action", () => {
    render(
      <InvitationView
        token="synthetic"
        hasToken
        current={{ subject: { primaryEmail: "alex@example.test" } }}
      />,
    );
    expect(
      screen
        .getByRole("button", { name: "Accept invitation" })
        .closest("form")
        ?.getAttribute("action"),
    ).toBe("/actions/acceptOrganizationInvitationAction");
  });
});
