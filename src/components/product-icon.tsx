"use client";

import { useState } from "react";
import Image from "next/image";

export function ProductIcon({
  name,
  src,
  size = 40,
  className,
}: {
  name: string;
  src: string;
  size?: number;
  className?: string;
}) {
  const [failedSrc, setFailedSrc] = useState("");
  const imageClassName = ["product-icon-image", className].filter(Boolean).join(" ");
  const placeholderClassName = ["product-placeholder", className].filter(Boolean).join(" ");

  if (!src || failedSrc === src) {
    return (
      <span className={placeholderClassName} aria-hidden="true">
        {name.trim().slice(0, 1).toUpperCase() || "?"}
      </span>
    );
  }

  return (
    <Image
      alt=""
      className={imageClassName}
      height={size}
      onError={() => setFailedSrc(src)}
      src={src}
      unoptimized
      width={size}
    />
  );
}
