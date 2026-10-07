import "server-only";

import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";

const MAX_HTML_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;
const FETCH_TIMEOUT_MS = 7_000;

export interface ProductSiteSuggestion {
  name: string;
  description: string;
  websiteUrl: string;
  iconUrl: string;
}

function isPublicIpv4(address: string): boolean {
  const octets = address.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  )
    return false;
  const [a, b, c] = octets;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && (b === 0 || b === 168)) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function isPublicIpv6(address: string): boolean {
  const normalized = address.toLowerCase().split("%")[0];
  if (normalized.startsWith("::ffff:")) {
    const mapped = normalized.slice("::ffff:".length);
    if (isIP(mapped) === 4) return isPublicIpv4(mapped);
    const parts = mapped.split(":");
    if (parts.length === 2) {
      const upper = Number.parseInt(parts[0], 16);
      const lower = Number.parseInt(parts[1], 16);
      const ipv4 = `${upper >> 8}.${upper & 255}.${lower >> 8}.${lower & 255}`;
      return isPublicIpv4(ipv4);
    }
    return false;
  }
  if (!/^[23]/.test(normalized)) return false;
  const [first, secondRaw = "0"] = normalized.split(":");
  const second = Number.parseInt(secondRaw || "0", 16);
  if (first === "2001" && (second <= 0x1ff || second === 0x200 || second === 0x0db8)) return false;
  if (first === "2002") return false;
  if (first === "3fff" && second <= 0x0fff) return false;
  return true;
}

function isPublicAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPublicIpv4(address);
  if (version === 6) return isPublicIpv6(address);
  return false;
}

interface ValidatedFetchTarget {
  url: URL;
  addresses: Array<{ address: string; family: number }>;
}

async function validateFetchUrl(input: string, deadline: number): Promise<ValidatedFetchTarget> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Enter a valid website address.");
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  ) {
    throw new Error("Use a public HTTPS website address.");
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  ) {
    throw new Error("Use a public HTTPS website address.");
  }
  const version = isIP(hostname);
  let addresses: Array<{ address: string; family: number }>;
  if (version) {
    addresses = [{ address: hostname, family: version }];
  } else {
    let dnsTimeout: ReturnType<typeof setTimeout> | undefined;
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) throw new Error("Product website request timed out.");
    try {
      addresses = await Promise.race([
        lookup(hostname, { all: true, verbatim: true }),
        new Promise<never>((_resolve, reject) => {
          dnsTimeout = setTimeout(
            () => reject(new Error("Product website request timed out.")),
            remainingMs,
          );
        }),
      ]);
    } catch {
      if (Date.now() >= deadline) throw new Error("Product website request timed out.");
      throw new Error("Website could not be resolved. Enter its details manually.");
    } finally {
      if (dnsTimeout) clearTimeout(dnsTimeout);
    }
  }
  if (!addresses.length || addresses.some((address) => !isPublicAddress(address.address))) {
    throw new Error(
      "This website cannot be fetched because it does not resolve to a public address.",
    );
  }
  url.hash = "";
  return { url, addresses };
}

interface ProductHttpResponse {
  statusCode: number;
  location: string | undefined;
  contentType: string;
  body: string;
}

async function requestValidatedTarget(
  target: ValidatedFetchTarget,
  deadline: number,
): Promise<ProductHttpResponse> {
  const selected = target.addresses[0];
  const hostname = target.url.hostname.replace(/^\[|\]$/g, "");
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) throw new Error("Product website request timed out.");
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(totalTimeout);
      callback();
    };
    const request = httpsRequest(
      target.url,
      {
        method: "GET",
        headers: { Accept: "text/html,application/xhtml+xml;q=0.9" },
        servername: isIP(hostname) ? undefined : hostname,
        lookup: (_name, options, callback) =>
          options.all
            ? callback(null, [{ address: selected.address, family: selected.family }])
            : callback(null, selected.address, selected.family),
      },
      (response) => {
        const announcedLength = Number(response.headers["content-length"] ?? 0);
        if (announcedLength > MAX_HTML_BYTES) {
          response.destroy();
          finish(() => reject(new Error("This website returned too much content to import.")));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer | string) => {
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          size += bytes.byteLength;
          if (size > MAX_HTML_BYTES) {
            response.destroy();
            finish(() => reject(new Error("This website returned too much content to import.")));
            return;
          }
          chunks.push(bytes);
        });
        response.on("end", () =>
          finish(() =>
            resolve({
              statusCode: response.statusCode ?? 0,
              location: response.headers.location,
              contentType: response.headers["content-type"]?.toLowerCase() ?? "",
              body: Buffer.concat(chunks).toString("utf8"),
            }),
          ),
        );
        response.on("error", (error) => finish(() => reject(error)));
      },
    );
    const totalTimeout = setTimeout(
      () => request.destroy(new Error("Product website request timed out.")),
      remainingMs,
    );
    request.setTimeout(remainingMs, () =>
      request.destroy(new Error("Product website request timed out.")),
    );
    request.on("error", (error) => finish(() => reject(error)));
    request.end();
  });
}

async function fetchPublicHtml(startUrl: string): Promise<{ html: string; finalUrl: URL }> {
  const deadline = Date.now() + FETCH_TIMEOUT_MS;
  let currentTarget = await validateFetchUrl(startUrl, deadline);
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await requestValidatedTarget(currentTarget, deadline);
    if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
      if (!response.location || redirectCount === MAX_REDIRECTS)
        throw new Error("The website redirected too many times.");
      currentTarget = await validateFetchUrl(
        new URL(response.location, currentTarget.url).toString(),
        deadline,
      );
      continue;
    }
    if (response.statusCode < 200 || response.statusCode >= 300)
      throw new Error("The website could not be fetched. Enter its details manually.");
    if (
      !response.contentType.includes("text/html") &&
      !response.contentType.includes("application/xhtml+xml")
    ) {
      throw new Error("This address did not return a web page. Enter its details manually.");
    }
    return { html: response.body, finalUrl: currentTarget.url };
  }
  throw new Error("The website redirected too many times.");
}

function decodeEntities(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
    (entity, part: string) => {
      if (part[0] === "#") {
        const numeric =
          part[1]?.toLowerCase() === "x"
            ? Number.parseInt(part.slice(2), 16)
            : Number.parseInt(part.slice(1), 10);
        return Number.isFinite(numeric) && numeric >= 0 && numeric <= 0x10ffff
          ? String.fromCodePoint(numeric)
          : entity;
      }
      const named: Record<string, string> = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
        nbsp: " ",
      };
      return named[part.toLowerCase()] ?? entity;
    },
  );
}

function attributes(tag: string): Record<string, string> {
  const result: Record<string, string> = {};
  const pattern = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  for (const match of tag.matchAll(pattern)) {
    result[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return result;
}

function cleanText(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function metaValue(html: string, keys: readonly string[]): string {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    const key = (attrs.property ?? attrs.name ?? attrs.itemprop ?? "").toLowerCase();
    if (keys.includes(key) && attrs.content) return cleanText(attrs.content);
  }
  return "";
}

export async function fetchProductSiteSuggestion(
  websiteUrl: string,
): Promise<ProductSiteSuggestion> {
  const { html, finalUrl } = await fetchPublicHtml(websiteUrl);
  const title =
    metaValue(html, ["og:site_name", "og:title", "twitter:title"]) ||
    cleanText(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "") ||
    finalUrl.hostname.replace(/^www\./i, "");
  const description = metaValue(html, [
    "description",
    "og:description",
    "twitter:description",
  ]).slice(0, 500);
  let icon = "";
  let touchIcon = "";
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = attributes(match[0]);
    const relations = attrs.rel?.toLowerCase().split(/\s+/) ?? [];
    if (!attrs.href) continue;
    if (relations.includes("icon")) {
      icon = attrs.href;
      break;
    }
    if (!touchIcon && relations.includes("apple-touch-icon")) touchIcon = attrs.href;
  }
  if (!icon) icon = touchIcon || metaValue(html, ["og:image", "twitter:image"]);
  let iconUrl = "";
  if (icon) {
    try {
      const resolved = new URL(icon, finalUrl);
      if (resolved.protocol === "https:" && !resolved.username && !resolved.password)
        iconUrl = resolved.toString();
    } catch {
      iconUrl = "";
    }
  }
  return { name: title.slice(0, 120), description, websiteUrl: finalUrl.toString(), iconUrl };
}
