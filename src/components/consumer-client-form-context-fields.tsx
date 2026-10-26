export function ConsumerClientFormContextFields({
  organizationId,
  productId,
  returnTo,
  clientId,
}: {
  organizationId: string;
  productId: string;
  returnTo: string;
  clientId?: string;
}) {
  return (
    <>
      <input type="hidden" name="organizationId" value={organizationId} />
      <input type="hidden" name="productId" value={productId} />
      <input type="hidden" name="returnTo" value={returnTo} />
      {clientId ? <input type="hidden" name="clientId" value={clientId} /> : null}
    </>
  );
}
