"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { ProductLookupState } from "@/app/actions";
import { submitStableAction } from "@/lib/action-client";
import { productSlug } from "@/lib/product-slug";
import {
  ProductDetailsReviewStep,
  ProductWebsiteLookupStep,
} from "@/components/product-setup-steps";

export function ProductSetupForm({ organizationId }: { organizationId: string }) {
  const [lookupState, setLookupState] = useState<ProductLookupState>({});
  const [pending, setPending] = useState(false);
  const [source, setSource] = useState("");
  const [manual, setManual] = useState(false);
  const [name, setName] = useState("");
  const [productId, setProductId] = useState("");
  const [productIdEdited, setProductIdEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [iconUrl, setIconUrl] = useState("");

  async function handleLookupSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      setLookupState(
        await submitStableAction<ProductLookupState>(
          "lookupProductWebsiteAction",
          new FormData(event.currentTarget),
        ),
      );
    } catch (error) {
      setLookupState({
        error: error instanceof Error ? error.message : "Please try again.",
        source,
      });
    } finally {
      setPending(false);
    }
  }

  /* eslint-disable react-hooks/set-state-in-effect -- The server action returns a suggested editable draft. */
  useEffect(() => {
    const suggestion = lookupState.suggestion;
    if (!suggestion) return;
    setName(suggestion.name);
    setProductId(productSlug(suggestion.name));
    setProductIdEdited(false);
    setDescription(suggestion.description);
    setWebsiteUrl(suggestion.websiteUrl);
    setIconUrl(suggestion.iconUrl);
    setManual(false);
  }, [lookupState.suggestion]);

  useEffect(() => {
    if (!lookupState.source) return;
    setSource(lookupState.source);
  }, [lookupState.source]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function setNameValue(value: string) {
    setName(value);
    if (!productIdEdited) setProductId(productSlug(value));
  }

  function startManualEntry() {
    setManual(true);
    try {
      const url = new URL(source);
      setWebsiteUrl(url.toString());
      setNameValue(url.hostname.replace(/^www\./i, ""));
    } catch {
      // Leave the editable fields empty when the entered address is incomplete.
    }
  }

  const showDetails = manual || !!lookupState.suggestion;

  return (
    <div className="product-setup-flow">
      <ProductWebsiteLookupStep
        onLookupSubmit={handleLookupSubmit}
        lookupState={lookupState}
        onStartManualEntry={startManualEntry}
        onSourceChange={setSource}
        pending={pending}
        showDetails={showDetails}
        source={source}
        organizationId={organizationId}
      />
      {showDetails ? (
        <ProductDetailsReviewStep
          description={description}
          iconUrl={iconUrl}
          name={name}
          onDescriptionChange={setDescription}
          onIconUrlChange={setIconUrl}
          onNameChange={setNameValue}
          onProductIdChange={(value) => {
            setProductId(value.toLowerCase());
            setProductIdEdited(true);
          }}
          onWebsiteUrlChange={setWebsiteUrl}
          organizationId={organizationId}
          productId={productId}
          websiteUrl={websiteUrl}
        />
      ) : null}
    </div>
  );
}
