import "server-only";

import { redirect } from "next/navigation";
import { getCurrentSession, isAdministrator } from "@/lib/auth/service";

export function publicActionError(error: unknown): string {
  if (!(error instanceof Error)) return "Perminister could not complete that request.";
  const safePrefixes = [
    "An account with this email address already exists.",
    "That System Concepts ID is already in use.",
    "Email or password is incorrect.",
    "Use a password",
    "Password must be",
    "Enter a valid email address.",
    "First name must be 80 characters or fewer.",
    "Last name must be 80 characters or fewer.",
    "Enter a valid product ID.",
    "Enter a valid project ID.",
    "Enter a valid workspace ID.",
    "Enter 1 to 32 valid action names.",
    "Choose a future expiration time.",
    "Choose an active account.",
    "Choose an active, email-verified account.",
    "An active, email-verified account is required to create an API key.",
    "Join this organization before creating an API key.",
    "API keys can only include actions granted to your account.",
    "Choose a product in this organization.",
    "Choose a member of this organization.",
    "Choose a member of this product.",
    "This person is already a product member.",
    "Only a product owner can invite a product administrator.",
    "A product must keep at least one owner.",
    "You do not have permission to manage this product.",
    "Join this product before creating an API key.",
    "This person is already a member of the organization.",
    "Only an organization owner can invite an administrator.",
    "An organization must keep at least one owner.",
    "You do not have permission to manage this organization.",
    "That product ID is already in use in this organization.",
    "A different product with this ID already exists in this organization. Resolve that conflict before adding the shared product.",
    "This public product is no longer available.",
    "This product is archived. Restore it before making changes.",
    "Archive this product before deleting it.",
    "Confirm removing the product from its installed organizations.",
    "Product installations changed. Retry deleting the archived product.",
    "A product being deleted cannot be restored.",
    "The product publisher is no longer available to restore this product.",
    "Another organization now publishes a product with this ID. This archived product cannot be restored while that publisher is active.",
    "This product is already being deleted.",
    "Shared product details are controlled by the publishing organization.",
    "Shared access roles are controlled by the publishing organization.",
    "App clients are managed by the product publisher.",
    "Confirm making this product private to remove it and revoke access in other organizations.",
    "Choose public or private product visibility.",
    "Only a public publisher product can be transferred.",
    "Only an active private product can be moved directly.",
    "A product with this ID already exists in the destination organization.",
    "The destination already has data for this product ID.",
    "Remove shared product installations before moving this product.",
    "Resume the product move to its existing destination.",
    "A product move is in progress. Resume it before making changes.",
    "This product ID is reserved by an incomplete move. Resume it first.",
    "Choose a different destination organization.",
    "Choose an approved destination organization.",
    "The destination already has a product with this product ID.",
    "This product has an incomplete transfer. Resume it at its existing destination first.",
    "The previous transfer cannot be resumed safely.",
    "Use a product ID with letters, numbers, dots, underscores, colons, or hyphens.",
    "Enter a product name up to 120 characters.",
    "The product description must be 500 characters or fewer.",
    "Organization names must be 2 to 80 characters.",
    "This invitation is invalid or expired, or it was sent to another email address.",
    "Only an active, unexpired API key can be rotated.",
    "Enter an application name up to 80 characters.",
    "Enter a valid app origin.",
    "Use an HTTPS app origin, or an HTTP localhost or 127.0.0.1 origin, without a path, query, or fragment.",
    "Session lifetime must be between 5 minutes and 30 days.",
    "Choose whether self-registration is enabled.",
    "Choose an active application client for this product.",
    "Application client not found.",
    "Choose one of your own API keys to rotate.",
    "You cannot disable the currently configured administrator account.",
    "Email delivery is not configured.",
    "Resend could not be reached.",
    "Enter a valid website address.",
    "Use a public HTTPS website address.",
    "This website cannot be fetched because it does not resolve to a public address.",
    "The website redirected too many times.",
    "This website returned too much content to import.",
    "The website could not be fetched. Enter its details manually.",
    "This address did not return a web page. Enter its details manually.",
    "Website could not be resolved. Enter its details manually.",
    "Product website request timed out.",
    "Too many product lookups. Try again in a minute.",
    "Organization is busy. Try again shortly.",
  ];
  if (safePrefixes.some((prefix) => error.message.startsWith(prefix))) return error.message;
  if (/^Resend rejected the message \(HTTP [0-9]{3}\)\./.test(error.message)) return error.message;
  return "Perminister could not complete that request. Check the Spaces and mail configuration, then try again.";
}

export function firstValue(data: FormData, name: string): string {
  const value = data.get(name);
  return typeof value === "string" ? value : "";
}

export function dashboardReturnTo(data: FormData): string {
  const value = firstValue(data, "returnTo");
  return value.startsWith("/dashboard/") || value === "/dashboard" ? value : "/dashboard";
}

export async function requireOperationsAdministratorContext(
  formData: FormData,
  administratorRequiredPath = "/dashboard",
) {
  const current = await getCurrentSession();
  if (!current) redirect("/login");
  if (!isAdministrator(current.subject)) redirect(administratorRequiredPath);
  return {
    current,
    organizationId: firstValue(formData, "operationsOrganizationId"),
  };
}
