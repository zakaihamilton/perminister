"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { ConsumerClientActionState } from "@/app/actions";
import { ConsumerClientCreateForm } from "@/components/consumer-client-create-form";
import { ConsumerClientSecretDetails } from "@/components/consumer-client-secret-details";
import { submitStableAction } from "@/lib/action-client";

export function ConsumerClientCreationManager({
  organizationId,
  productId,
  productName,
  returnTo,
}: {
  organizationId: string;
  productId: string;
  productName: string;
  returnTo: string;
}) {
  const [state, setState] = useState<ConsumerClientActionState>({});
  const [pending, setPending] = useState(false);
  const hasSecret = Boolean(state.clientId && state.secret);

  useEffect(() => {
    if (!hasSecret) return;

    const message =
      "This app client secret is shown only once. If you leave this page, you will not be able to view it again. Have you saved it?";
    const secretPageUrl = new URL(window.location.href);
    let navigationConfirmed = false;
    let restoringHistory = false;
    let restoreTimer: number | undefined;

    function confirmPageNavigation(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      const target = event.target;
      if (!(target instanceof Element)) return;

      const organizationOption = target.closest(
        ".org-switcher [role='option'][aria-selected='false']",
      );
      if (organizationOption) {
        if (!window.confirm(message)) {
          event.preventDefault();
          event.stopPropagation();
        } else {
          navigationConfirmed = true;
        }
        return;
      }

      const link = target.closest<HTMLAnchorElement>("a[href]");
      if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self"))
        return;

      const destination = new URL(link.href, window.location.href);
      const current = new URL(window.location.href);
      if (
        (destination.protocol !== "http:" && destination.protocol !== "https:") ||
        (destination.origin === current.origin &&
          destination.pathname === current.pathname &&
          destination.search === current.search)
      ) {
        return;
      }

      if (!window.confirm(message)) {
        event.preventDefault();
        event.stopPropagation();
      } else {
        navigationConfirmed = true;
      }
    }

    function confirmHistoryNavigation(event: PopStateEvent) {
      if (restoringHistory) {
        if (window.location.href === secretPageUrl.href) {
          restoringHistory = false;
          if (restoreTimer !== undefined) window.clearTimeout(restoreTimer);
          restoreTimer = undefined;
          return;
        }

        restoringHistory = false;
        if (restoreTimer !== undefined) window.clearTimeout(restoreTimer);
        restoreTimer = undefined;
      }

      const destination = new URL(window.location.href);
      if (
        destination.origin === secretPageUrl.origin &&
        destination.pathname === secretPageUrl.pathname &&
        destination.search === secretPageUrl.search
      ) {
        return;
      }

      if (window.confirm(message)) {
        navigationConfirmed = true;
        return;
      }

      // Stop Next from applying the traversed route while restoring this entry.
      event.stopImmediatePropagation();
      restoringHistory = true;
      window.history.forward();
      restoreTimer = window.setTimeout(() => {
        restoringHistory = false;
        restoreTimer = undefined;
      }, 2000);
    }

    function confirmPageUnload(event: BeforeUnloadEvent) {
      if (navigationConfirmed) return;
      event.preventDefault();
      event.returnValue = "";
    }

    document.addEventListener("click", confirmPageNavigation, true);
    window.addEventListener("popstate", confirmHistoryNavigation, true);
    window.addEventListener("beforeunload", confirmPageUnload);

    return () => {
      document.removeEventListener("click", confirmPageNavigation, true);
      window.removeEventListener("popstate", confirmHistoryNavigation, true);
      window.removeEventListener("beforeunload", confirmPageUnload);
      if (restoreTimer !== undefined) window.clearTimeout(restoreTimer);
    };
  }, [hasSecret]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    try {
      setState(
        await submitStableAction<ConsumerClientActionState>(
          "createOrRotateConsumerClientAction",
          new FormData(event.currentTarget),
        ),
      );
    } catch (error) {
      setState({ error: error instanceof Error ? error.message : "Please try again." });
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      {state.error ? (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.clientId && state.secret ? (
        <ConsumerClientSecretDetails clientId={state.clientId} secret={state.secret} />
      ) : null}
      {!hasSecret ? (
        <ConsumerClientCreateForm
          onSubmit={handleSubmit}
          organizationId={organizationId}
          productId={productId}
          productName={productName}
          returnTo={returnTo}
          pending={pending}
        />
      ) : null}
    </>
  );
}
