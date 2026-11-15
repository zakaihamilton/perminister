import { expect, test } from "@playwright/test";

const widths = [320, 390, 768, 1024, 1280] as const;
const themes = ["light", "dark"] as const;
const previewCases = [
  {
    name: "long product breadcrumb",
    path: "/ui-preview?screen=product-overview&scenario=long-organization-names",
  },
  {
    name: "high-volume member list",
    path: "/ui-preview?screen=members&scenario=many-records",
  },
] as const;

for (const width of widths) {
  for (const theme of themes) {
    test(`${width}px ${theme} dashboard layout stays within its responsive guardrails`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript((selectedTheme) => {
        window.localStorage.setItem("perminister-theme", selectedTheme);
      }, theme);

      for (const preview of previewCases) {
        await page.goto(preview.path);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await expect(page.locator(".pf-dashboard-toolbar")).toBeVisible();
        await expect(page.locator(".dashboard-page-context")).toBeVisible();
        await expect(page.locator(".pf-dashboard-content")).toBeVisible();
        await expect(page.locator(".dashboard-page-heading")).toBeVisible();

        const layout = await page.evaluate(() => {
          const toolbar = document.querySelector<HTMLElement>(".pf-dashboard-toolbar");
          const content = document.querySelector<HTMLElement>(".pf-dashboard-content");
          const contentBody = content?.firstElementChild as HTMLElement | null;
          const heading = content?.querySelector<HTMLElement>(".dashboard-page-heading");
          if (!toolbar || !content || !contentBody) {
            throw new Error("The dashboard shell is missing its toolbar or content region.");
          }

          const breadcrumbContext = toolbar.querySelector<HTMLElement>(".dashboard-page-context");
          const rect = (element: Element) => {
            const bounds = element.getBoundingClientRect();
            return {
              left: bounds.left,
              right: bounds.right,
              top: bounds.top,
              bottom: bounds.bottom,
            };
          };
          const isVisible = (element: Element) => {
            const style = getComputedStyle(element);
            const bounds = element.getBoundingClientRect();
            return (
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              Number(style.opacity) !== 0 &&
              bounds.width > 0 &&
              bounds.height > 0
            );
          };
          const visibleChildren = (element: Element) =>
            Array.from(element.children)
              .filter(isVisible)
              .map((child) => ({ selector: child.className || child.tagName, ...rect(child) }));
          const overlaps = (children: ReturnType<typeof visibleChildren>) => {
            const pairs: string[] = [];
            for (let first = 0; first < children.length; first += 1) {
              for (let second = first + 1; second < children.length; second += 1) {
                const a = children[first];
                const b = children[second];
                const horizontal = Math.min(a.right, b.right) - Math.max(a.left, b.left);
                const vertical = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
                if (horizontal > 1 && vertical > 1) {
                  pairs.push(`${a.selector} overlaps ${b.selector}`);
                }
              }
            }
            return pairs;
          };
          const toolbarStyle = getComputedStyle(toolbar);
          const contentStyle = getComputedStyle(content);
          const headingStyle = heading ? getComputedStyle(heading) : null;
          const toolbarChildren = visibleChildren(toolbar);
          const breadcrumbChildren = breadcrumbContext ? visibleChildren(breadcrumbContext) : [];
          const contentChildren = heading ? visibleChildren(heading) : [];
          const viewportWidth = document.documentElement.clientWidth;

          return {
            viewportWidth,
            documentScrollWidth: document.documentElement.scrollWidth,
            bodyScrollWidth: document.body.scrollWidth,
            toolbarScrollWidth: toolbar.scrollWidth,
            toolbarClientWidth: toolbar.clientWidth,
            contentScrollWidth: content.scrollWidth,
            contentClientWidth: content.clientWidth,
            toolbar: rect(toolbar),
            contentBody: rect(contentBody),
            toolbarChildren,
            toolbarOverlaps: overlaps(toolbarChildren),
            breadcrumbOverlaps: overlaps(breadcrumbChildren),
            headingChildren: contentChildren,
            headingOverlaps: overlaps(contentChildren),
            toolbarPadding: {
              top: Number.parseFloat(toolbarStyle.paddingTop),
              left: Number.parseFloat(toolbarStyle.paddingLeft),
              right: Number.parseFloat(toolbarStyle.paddingRight),
            },
            contentPadding: {
              top: Number.parseFloat(contentStyle.paddingTop),
              left: Number.parseFloat(contentStyle.paddingLeft),
              right: Number.parseFloat(contentStyle.paddingRight),
            },
            headingMarginBottom: headingStyle
              ? Number.parseFloat(headingStyle.marginBottom)
              : null,
            contentLeadGap:
              contentBody.getBoundingClientRect().top - toolbar.getBoundingClientRect().bottom,
          };
        });

        const context = `${preview.name}, ${width}px, ${theme}: ${JSON.stringify(layout)}`;
        const isMobile = width <= 780;
        const responsivePadding = (minimum: number, maximum: number) =>
          Math.min(maximum, Math.max(minimum, width * 0.03));

        expect(layout.documentScrollWidth, context).toBeLessThanOrEqual(layout.viewportWidth);
        expect(layout.bodyScrollWidth, context).toBeLessThanOrEqual(layout.viewportWidth);
        expect(layout.toolbarScrollWidth, context).toBeLessThanOrEqual(layout.toolbarClientWidth);
        expect(layout.contentScrollWidth, context).toBeLessThanOrEqual(layout.contentClientWidth);
        expect(layout.toolbar.left, context).toBeGreaterThanOrEqual(0);
        expect(layout.toolbar.right, context).toBeLessThanOrEqual(layout.viewportWidth);
        expect(layout.toolbarOverlaps, context).toEqual([]);
        expect(layout.breadcrumbOverlaps, context).toEqual([]);
        expect(layout.headingOverlaps, context).toEqual([]);

        expect(layout.toolbarPadding.top, context).toBeCloseTo(isMobile ? 7 : 8, 1);
        expect(layout.toolbarPadding.left, context).toBeCloseTo(
          isMobile ? 14 : responsivePadding(18, 42),
          1,
        );
        expect(layout.toolbarPadding.right, context).toBeCloseTo(
          isMobile ? 14 : responsivePadding(18, 42),
          1,
        );
        expect(layout.contentPadding.top, context).toBeCloseTo(
          isMobile ? 20 : responsivePadding(20, 42),
          1,
        );
        expect(layout.contentPadding.left, context).toBeCloseTo(
          isMobile ? 16 : responsivePadding(20, 42),
          1,
        );
        expect(layout.contentPadding.right, context).toBeCloseTo(
          isMobile ? 16 : responsivePadding(20, 42),
          1,
        );
        expect(layout.contentLeadGap, context).toBeCloseTo(layout.contentPadding.top, 1);
        if (layout.headingMarginBottom !== null) {
          expect(layout.headingMarginBottom, context).toBeCloseTo(width <= 740 ? 19 : 25, 1);
        }
      }
    });
  }
}
