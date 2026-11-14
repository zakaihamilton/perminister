import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { getConsumerAuthPresentation } from "../../src/components/consumer-auth-presentation";

describe("consumer login presentation catalog", () => {
  it.each([
    ["postparticle", "Make room for your next story."],
    ["visitoring", "Know your traffic."],
    ["nanogres", "A clearer home for your Postgres databases."],
  ])("selects the registered %s product panel", (productId, heading) => {
    const presentation = getConsumerAuthPresentation(productId);
    expect(presentation).not.toBeNull();
    expect(renderToStaticMarkup(createElement("div", null, presentation!.aside))).toContain(heading);
  });

  it("uses the generic Perminister shell for unknown products", () => {
    expect(getConsumerAuthPresentation("unknown-product")).toBeNull();
  });
});
