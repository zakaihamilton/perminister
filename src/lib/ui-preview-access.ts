export function isUiPreviewAllowed(): boolean {
  return (
    (process.env.NODE_ENV === "development" && process.env.PERMINISTER_UI_PREVIEW === "1") ||
    process.env.VERCEL_ENV === "preview"
  );
}
