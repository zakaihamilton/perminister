"use client";

import { useActionState, useEffect, useState } from "react";
import { ProductIcon } from "@/components/product-icon";
import {
  createOrganizationProductAction,
  lookupProductWebsiteAction,
  type ProductLookupState,
} from "@/app/actions";
import { productSlug } from "@/lib/product-slug";

export function ProductSetupForm({ organizationId }: { organizationId: string }) {
  const [lookupState, lookupAction, pending] = useActionState<ProductLookupState, FormData>(
    lookupProductWebsiteAction,
    {},
  );
  const [source, setSource] = useState("");
  const [manual, setManual] = useState(false);
  const [name, setName] = useState("");
  const [productId, setProductId] = useState("");
  const [productIdEdited, setProductIdEdited] = useState(false);
  const [description, setDescription] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [iconUrl, setIconUrl] = useState("");

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
      <section className="product-setup-step">
        <span className="onboarding-step">01</span>
        <div className="product-setup-step-body">
          <h2>Start with a website</h2>
          <p>Enter a website address to suggest product details, or enter the details manually.</p>
          <form action={lookupAction} className="product-source-form">
            <input type="hidden" name="organizationId" value={organizationId} />
            <label>
              Website address
              <input
                name="source"
                type="url"
                value={source}
                onChange={(event) => setSource(event.target.value)}
                placeholder="https://example.com"
                required
                maxLength={2048}
              />
            </label>
            <button className="button button-primary" type="submit" disabled={pending}>
              {pending ? "Looking up…" : "Fetch website details"}
            </button>
          </form>
          {lookupState.error ? (
            <p className="form-error" role="alert">
              {lookupState.error}
            </p>
          ) : null}
          {!showDetails ? (
            <button
              className="text-link product-manual-button"
              type="button"
              onClick={startManualEntry}
            >
              Enter product details manually
            </button>
          ) : null}
        </div>
      </section>

      {showDetails ? (
        <section className="product-setup-step product-details-step">
          <span className="onboarding-step">02</span>
          <div className="product-setup-step-body">
            <h2>Review product details</h2>
            <p>Your product ID stays stable after creation and is scoped to this organization.</p>
            {iconUrl ? (
              <ProductIcon name={name} src={iconUrl} className="product-icon-preview" size={45} />
            ) : null}
            <form
              action={createOrganizationProductAction}
              className="auth-form product-details-form"
            >
              <input type="hidden" name="organizationId" value={organizationId} />
              <label>
                Product name
                <input
                  name="name"
                  value={name}
                  onChange={(event) => setNameValue(event.target.value)}
                  required
                  maxLength={120}
                />
              </label>
              <label>
                Product ID
                <input
                  name="productId"
                  value={productId}
                  onChange={(event) => {
                    setProductId(event.target.value);
                    setProductIdEdited(true);
                  }}
                  required
                  maxLength={128}
                  pattern="[a-zA-Z0-9][a-zA-Z0-9._:-]*"
                />
                <span className="form-hint">
                  Generated from the name. Edit it here if your integration already uses a different
                  ID.
                </span>
              </label>
              <label>
                Website
                <input
                  name="websiteUrl"
                  type="url"
                  value={websiteUrl}
                  onChange={(event) => setWebsiteUrl(event.target.value)}
                  required
                  maxLength={2048}
                />
              </label>
              <label>
                Description
                <textarea
                  name="description"
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  maxLength={500}
                  rows={3}
                />
              </label>
              <label>
                Icon URL <span className="form-hint">Optional</span>
                <input
                  name="iconUrl"
                  type="url"
                  value={iconUrl}
                  onChange={(event) => setIconUrl(event.target.value)}
                  maxLength={2048}
                />
              </label>
              <button
                className="button button-primary"
                type="submit"
                disabled={!name.trim() || !productId.trim() || !websiteUrl.trim()}
              >
                Create product
              </button>
            </form>
          </div>
        </section>
      ) : null}
    </div>
  );
}
