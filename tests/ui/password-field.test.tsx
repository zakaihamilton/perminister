// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PasswordField } from "@/components/password-field";

describe("password visibility", () => {
  it("reveals and hides each password without changing its value or submitting", async () => {
    const user = userEvent.setup();
    let submissions = 0;
    render(
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submissions += 1;
        }}
      >
        <PasswordField
          label="Password"
          name="password"
          autoComplete="new-password"
          hint="Use at least 15 characters."
        />
        <PasswordField
          label="Confirm password"
          name="confirmPassword"
          autoComplete="new-password"
        />
      </form>,
    );
    const password = screen.getByLabelText("Password") as HTMLInputElement;
    const confirmation = screen.getByLabelText("Confirm password") as HTMLInputElement;
    await user.type(password, "a long passphrase");
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(password.type).toBe("text");
    expect(password.value).toBe("a long passphrase");
    expect(confirmation.type).toBe("password");
    expect(password.getAttribute("aria-describedby")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Hide password" }));
    expect(password.type).toBe("password");
    expect(submissions).toBe(0);
  });
});
