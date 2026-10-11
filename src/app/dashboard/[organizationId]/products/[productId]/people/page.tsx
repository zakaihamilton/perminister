import { revokeProductInvitationAction } from "@/app/actions";
import { DashboardHeading } from "@/components/dashboard-shell";
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
      <DashboardHeading description="Manage this product’s members and their product roles." />
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
        Product Owners change roles or remove members. Product Owners and Admins can invite Members
        and manage access grants. A member’s role does not grant API actions.
      </p>
    </>
  );
}
