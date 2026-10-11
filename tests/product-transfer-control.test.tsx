// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions", () => ({ transferPublicProductAction: vi.fn() }));

import { ProductTransferControl } from "@/components/product-transfer-control";

const destinations = [
  { organizationId: "11111111-1111-4111-8111-111111111111", name: "Northstar" },
  { organizationId: "22222222-2222-4222-8222-222222222222", name: "Acme" },
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  Reflect.deleteProperty(HTMLDialogElement.prototype, "showModal");
  Reflect.deleteProperty(HTMLDialogElement.prototype, "close");
});

describe("public product transfer control", () => {
  it("offers the supplied eligible destinations and confirms the selected organization", async () => {
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
      configurable: true,
      value: vi.fn(function (this: HTMLDialogElement) {
        this.open = true;
      }),
    });
    Object.defineProperty(HTMLDialogElement.prototype, "close", {
      configurable: true,
      value: vi.fn(function (this: HTMLDialogElement) {
        this.open = false;
      }),
    });
    const user = userEvent.setup();
    render(
      <ProductTransferControl
        productRecordId="33333333-3333-4333-8333-333333333333"
        productId="atlas"
        productName="Atlas"
        destinations={destinations}
      />,
    );

    await user.click(screen.getByRole("combobox", { name: "Transfer to organization" }));
    expect(screen.getByRole("option", { name: "Northstar" })).toBeTruthy();
    expect(screen.getByRole("option", { name: "Acme" })).toBeTruthy();

    await user.click(screen.getByRole("option", { name: "Northstar" }));
    await user.click(screen.getByRole("button", { name: "Transfer owner" }));

    expect(screen.getByRole("dialog").textContent).toContain("Transfer Atlas to Northstar?");
    expect(screen.getByRole("button", { name: "Confirm transfer" })).toBeTruthy();
  });

  it("explains when no approved destination is available", () => {
    render(
      <ProductTransferControl
        productRecordId="33333333-3333-4333-8333-333333333333"
        productId="atlas"
        productName="Atlas"
        destinations={[]}
      />,
    );

    expect(screen.getByText("No approved destination without a product ID conflict.")).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Transfer to organization" })).toBeNull();
  });
});
