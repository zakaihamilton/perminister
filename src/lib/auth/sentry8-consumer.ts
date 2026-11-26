export const SENTRY8_PRODUCT_ID = "sentry8";

export function isSentry8ConsumerClient(
  clientId: string,
  productId: string,
): boolean {
  const configuredClientId =
    process.env.PERMINISTER_SENTRY8_CONSUMER_CLIENT_ID?.trim();
  return (
    !!configuredClientId &&
    clientId === configuredClientId &&
    productId.trim().toLowerCase() === SENTRY8_PRODUCT_ID
  );
}
