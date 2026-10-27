// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);

vi.mock("@/components/site-shell", () => ({ SiteHeader: () => null, SiteFooter: () => null }));
import { AuthorizationView } from "@/components/authorization-view";
import { InvitationView } from "@/components/invitation-view";

const authorization = {
  clientId: "preview",
  redirectUri: "https://example.test/callback",
  responseType: "code" as const,
  state: "preview",
  codeChallenge: "preview",
};
describe("authorization and invitation views", () => {
  it("renders ready authorization with the original action", () => {
    render(
      <AuthorizationView
        authorization={authorization}
        client={{ appName: "Example app" }}
        current={{ subject: { primaryEmail: "alex@example.test" } }}
        error=""
      />,
    );
    expect(
      screen
        .getByRole("button", { name: "Continue to Example app" })
        .closest("form")
        ?.getAttribute("action"),
    ).toBe("/actions/approveConsumerAuthorizationAction");
  });
  it("shows an invalid authorization without approval", () => {
    render(<AuthorizationView authorization={null} client={null} current={null} error="" />);
    expect(screen.getByRole("alert").textContent).toContain("invalid or expired");
    expect(screen.queryByRole("button", { name: /Continue to/ })).toBeNull();
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
