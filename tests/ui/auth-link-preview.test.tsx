// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AuthLinkContent } from "@/components/auth-link-pages";

describe("authentication link content", () => {
  it("shows the verification form when a token is present", () => {
    render(<AuthLinkContent kind="verify-email" params={{}} token="synthetic" />);
    expect(screen.getByRole("button", { name: "Verify email" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Verify email" }).closest("form")?.getAttribute("action"),
    ).toBe("/actions/verifyEmailAction");
  });
  it("shows missing token feedback for password recovery", () => {
    render(<AuthLinkContent kind="reset-password" params={{}} token="" />);
    expect(screen.getByText("This recovery link is missing its one-time token.")).toBeTruthy();
  });
});
