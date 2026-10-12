import { revokeProductInvitationAction } from "@/app/actions";
import { DashboardHeading } from "@/components/dashboard-shell";
import { ProductNavigation } from "@/components/product-navigation";
import { PendingInvitations } from "@/components/pending-invitations";
import {
  InviteProductMemberSection,
  ProductPeopleNotices,
  ProductPeopleSection,
} from "@/components/product-people-sections";
import { listProductInvitations, listProductMembers } from "@/lib/auth/service";
import {
  getProductPageContext,
  requireProductManagerRole,
  type ProductPageWithSearchParams,
} from "@/lib/auth/product-page-context";

export default async function ProductPeoplePage({
  params,
  searchParams,
}: ProductPageWithSearchParams) {
  const [{ current, organizationId, productId, access }, query] = await Promise.all([
    getProductPageContext(params),
    searchParams,
  ]);
  const role = requireProductManagerRole(access.membership?.role, organizationId, productId);

  const [members, invitations] = await Promise.all([
    listProductMembers(current.subject.subjectId, organizationId, productId),
    listProductInvitations(current.subject.subjectId, organizationId, productId),
  ]);
  const isOwner = role === "owner";
  return (
    <>
      <DashboardHeading description="Manage who can use this product and what they can do." />
      <ProductNavigation
        isSharedInstallation={Boolean(access.product.sharedProductRef)}
        organizationId={organizationId}
        productId={productId}
        productName={access.product.name}
        role={role}
      />
      <ProductPeopleNotices error={query.error} notice={query.notice} />
      <ProductPeopleSection
        isOwner={isOwner}
        members={members}
        organizationId={organizationId}
        productId={productId}
      />
      <InviteProductMemberSection
        isOwner={isOwner}
        organizationId={organizationId}
        productId={productId}
      />

      <PendingInvitations
        invitations={invitations}
        organizationId={organizationId}
        productId={productId}
        formAction={revokeProductInvitationAction}
      />
      <p className="role-help">
        Product owners can change roles and remove members. Product owners and admins can invite
        people and manage permissions. A member also needs permission assigned before they can use
        app actions.
      </p>
    </>
  );
}
