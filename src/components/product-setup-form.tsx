"use client";

import { useActionState, useEffect, useState } from "react";
import Image from "next/image";
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
  const [mode, setMode] = useState<"website" | "name">("website");
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
    if (mode === "website") {
      try {
        const url = new URL(source);
        setWebsiteUrl(url.toString());
        setNameValue(url.hostname.replace(/^www\./i, ""));
      } catch {
        // Leave the editable fields empty when the entered address is incomplete.
      }
    } else {
      setNameValue(source);
    }
  }

  const showDetails = manual || !!lookupState.suggestion;

  return (
    <div className="product-setup-flow">
      <section className="product-setup-step">
        <span className="onboarding-step">01</span>
        <div className="product-setup-step-body">
          <h2>Start with a website</h2>
          <p>
            Use a website address or search by product name. You can edit every suggested detail.
          </p>
          <div className="product-source-tabs" role="tablist" aria-label="Choose product source">
            <button
              type="button"
              role="tab"
              aria-selected={mode === "website"}
              onClick={() => setMode("website")}
            >
              I have a website
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "name"}
              onClick={() => setMode("name")}
            >
              Search by name
            </button>
          </div>
          <form action={lookupAction} className="product-source-form">
            <input type="hidden" name="mode" value={mode} />
            <input type="hidden" name="organizationId" value={organizationId} />
            <label>
              {mode === "website" ? "Website address" : "Product name"}
              <input
                name="source"
                type={mode === "website" ? "url" : "text"}
                value={source}
                onChange={(event) => setSource(event.target.value)}
                placeholder={mode === "website" ? "https://example.com" : "Acme Studio"}
                required
                maxLength={mode === "website" ? 2048 : 100}
              />
            </label>
            <button className="button button-primary" type="submit" disabled={pending}>
              {pending
                ? "Looking up…"
                : mode === "website"
                  ? "Fetch website details"
                  : "Search websites"}
            </button>
          </form>
          {lookupState.error ? (
            <p className="form-error" role="alert">
              {lookupState.error}
            </p>
          ) : null}
          {lookupState.matches?.length ? (
            <div className="website-match-list" aria-label="Website search results">
              <p>Choose the site that belongs to your product:</p>
              {lookupState.matches.map((match) => (
                <form action={lookupAction} key={match.url}>
                  <input type="hidden" name="mode" value="website" />
                  <input type="hidden" name="organizationId" value={organizationId} />
                  <input type="hidden" name="source" value={match.url} />
                  <button className="website-match" type="submit">
                    <span>
                      <strong>{match.title}</strong>
                      <small>{match.url}</small>
                      {match.description ? <small>{match.description}</small> : null}
                    </span>
                    <span>Use this site →</span>
                  </button>
                </form>
              ))}
            </div>
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
              <Image
                alt="Product icon preview"
                className="product-icon-preview"
                height={45}
                src={iconUrl}
                unoptimized
                width={45}
              />
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
