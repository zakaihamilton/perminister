import "server-only";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createConsumerClient,
  getCurrentSession,
  revokeConsumerClient,
  rotateConsumerClient,
  updateConsumerClient,
} from "@/lib/auth/service";
import { dashboardReturnTo, firstValue, publicActionError } from "./shared";

export interface ConsumerClientActionState {
  clientId?: string;
  secret?: string;
  updated?: boolean;
  error?: string;
}

async function consumerClientActionContext(formData: FormData) {
  const current = await getCurrentSession();
  if (!current) return null;
  return {
    current,
    organizationId: firstValue(formData, "organizationId"),
    productId: firstValue(formData, "productId"),
    clientId: firstValue(formData, "clientId"),
    returnTo: dashboardReturnTo(formData),
  };
}

function formLines(formData: FormData, name: string): string[] {
  return firstValue(formData, name)
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function consumerClientSettings(formData: FormData) {
  const sessionLifetimeHours = Number(firstValue(formData, "sessionLifetimeHours"));
  const registrationSetting = firstValue(formData, "selfRegistrationEnabled");
  if (registrationSetting !== "true" && registrationSetting !== "false") return null;
  return {
    appName: firstValue(formData, "appName"),
    appOrigin: firstValue(formData, "appOrigin"),
    redirectUris: formLines(formData, "redirectUris"),
    resourceUris: formLines(formData, "resourceUris"),
    oauthScopes: formLines(formData, "oauthScopes").flatMap((line) => line.split(/\s+/)),
    sessionLifetimeSeconds: Math.round(sessionLifetimeHours * 60 * 60),
    selfRegistrationEnabled: registrationSetting === "true",
  };
}

async function manageConsumerClientAction(
  formData: FormData,
  operation: "create-or-rotate" | "update",
): Promise<ConsumerClientActionState> {
  const context = await consumerClientActionContext(formData);
  if (!context) return { error: "Sign in again to manage application clients." };
  const { current, organizationId, productId, returnTo, clientId } = context;

  try {
    if (operation === "update") {
      const settings = consumerClientSettings(formData);
      if (!settings) {
        return { clientId, error: "Choose whether self-registration is enabled." };
      }
      await updateConsumerClient(
        current.subject.subjectId,
        organizationId,
        productId,
        clientId,
        settings,
      );
      revalidatePath(returnTo);
      return { clientId, updated: true };
    }

    if (clientId) {
      const credential = await rotateConsumerClient(
        current.subject.subjectId,
        organizationId,
        productId,
        clientId,
      );
      revalidatePath(returnTo);
      return credential;
    }

    const settings = consumerClientSettings(formData);
    if (!settings) return { error: "Choose whether self-registration is enabled." };
    const credential = await createConsumerClient(
      current.subject.subjectId,
      organizationId,
      productId,
      settings,
    );
    revalidatePath(returnTo);
    return credential;
  } catch (error) {
    return {
      ...(operation === "update" ? { clientId } : {}),
      error: publicActionError(error),
    };
  }
}

export async function createOrRotateConsumerClientAction(
  _previous: ConsumerClientActionState,
  formData: FormData,
): Promise<ConsumerClientActionState> {
  return manageConsumerClientAction(formData, "create-or-rotate");
}

export async function updateConsumerClientAction(
  _previous: ConsumerClientActionState,
  formData: FormData,
): Promise<ConsumerClientActionState> {
  return manageConsumerClientAction(formData, "update");
}

export async function revokeConsumerClientAction(formData: FormData): Promise<void> {
  const context = await consumerClientActionContext(formData);
  if (!context) redirect("/login");
  const { current, organizationId, productId, clientId, returnTo } = context;
  try {
    await revokeConsumerClient(current.subject.subjectId, organizationId, productId, clientId);
  } catch (error) {
    const message = encodeURIComponent(publicActionError(error));
    redirect(`${returnTo}?error=${message}`);
  }
  revalidatePath(returnTo);
  redirect(`${returnTo}?notice=client-revoked`);
}
