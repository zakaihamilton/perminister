import type { Metadata } from "next";

const publicOrigin = process.env.PERMINISTER_PUBLIC_ORIGIN?.trim();

export function withCanonical(metadata: Metadata, pathname: string): Metadata {
  return publicOrigin
    ? {
        ...metadata,
        alternates: { canonical: pathname },
      }
    : metadata;
}
