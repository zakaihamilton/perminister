import { ActivityFeed } from "@/components/activity-feed";
import { ConsumerClientCreationManager } from "@/components/consumer-client-creation-manager";
import { ConsumerClientManager } from "@/components/consumer-client-manager";
import { ConsumerClientSettingsForm } from "@/components/consumer-client-settings-form";
import { DashboardHeading } from "@/components/dashboard-shell";
import { PendingInvitations } from "@/components/pending-invitations";
import {
  CreateProductAccessRoleForm,
  EditProductAccessRoleForm,
  ProductAccessRoleCatalog,
} from "@/components/product-access-role-sections";
import {
  AccessGrantCreationSection,
  AccessGrantExplainer,
  ProductAccessGrantCard,
} from "@/components/product-access-sections";
import {
  ProductApiKeyCreationSection,
  ProductApiKeyRecords,
} from "@/components/product-api-key-sections";
import { ProductDetailsCard } from "@/components/product-details-card";
import { ProductNavigation } from "@/components/product-navigation";
import {
  AddExistingProductMemberSection,
  InviteProductMemberSection,
  ProductPeopleSection,
} from "@/components/product-people-sections";
import { ProductSetupForm } from "@/components/product-setup-form";
import type { InvitationId } from "@/lib/auth/domain";
import {
  accessRoles,
  client,
  organizationId,
  type PreviewContext,
  products,
} from "./fixtures";

export function ProductPreviewScreens({ context }: { context: PreviewContext }) {
  const {
    screen,
    scenario,
    empty,
    previewRole,
    isOwner,
    canManage,
    previewPathname,
    previewProducts,
    previewMembers,
    previewGrants,
    previewApiKeys,
    previewProductActivity,
    previewAccessRoles,
    invitationExpiry,
  } = context;

  return (
    <>
      {(screen?.startsWith("product-") || screen === "access-denied") && (
        <ProductNavigation
          isSharedInstallation={false}
          organizationId={organizationId}
          productId="field-notes"
          productName={previewProducts[0].name}
          role={previewRole}
          pathnameOverride={previewPathname}
        />
      )}
      {screen === "product-new" && (
        <>
          <DashboardHeading description="Start with your website and review the details before adding the product." />
          <ProductSetupForm organizationId={organizationId} />
        </>
      )}
      {screen === "product-role-new" && (
        <>
          <DashboardHeading description="Define a reusable set of app permission names for this product." />
          <section className="dashboard-card access-role-catalog-card">
            <h2>Create permission set</h2>
            <CreateProductAccessRoleForm
              accessRoleCount={0}
              organizationId={organizationId}
              productId="field-notes"
            />
          </section>
        </>
      )}
      {screen === "product-role-edit" && (
        <>
          <DashboardHeading description="Changes affect future assignments. Existing member permissions stay in place." />
          <section className="dashboard-card access-role-catalog-card">
            <div className="dashboard-card-heading">
              <div>
                <h2>Edit Editor</h2>
              </div>
            </div>
            <EditProductAccessRoleForm
              accessRole={accessRoles[0]}
              organizationId={organizationId}
              productId="field-notes"
              initialError={
                scenario === "permission-set-error"
                  ? "A permission set with that name already exists. Choose another name."
                  : undefined
              }
            />
          </section>
        </>
      )}
      {screen === "product-client-new" && (
        <>
          <DashboardHeading description="Connect an app backend to Perminister for Field Notes sign-in and permission checks." />
          <ConsumerClientCreationManager
            organizationId={organizationId}
            productId="field-notes"
            productName="Field Notes"
            returnTo="/ui-preview"
          />
        </>
      )}
      {screen === "product-invite" && (
        <>
          <DashboardHeading description="Invite someone to join Field Notes." />
          <InviteProductMemberSection
            isOwner={isOwner}
            organizationId={organizationId}
            productId="field-notes"
          />
        </>
      )}
      {screen === "product-access-new" && (
        <>
          <DashboardHeading description="Choose a member, define where their permissions apply, and select a permission set or custom actions." />
          <AccessGrantExplainer />
          <AccessGrantCreationSection
            eligibleMembers={empty ? [] : previewMembers}
            organizationId={organizationId}
            productId="field-notes"
            accessRoles={empty ? [] : previewAccessRoles}
          />
        </>
      )}
      {(screen === "product-overview" || screen === "product-move") && (
        <>
          <DashboardHeading
            description={
              screen === "product-move"
                ? "Manage this private product and move it to another organization you own."
                : previewProducts[0].description
            }
          />
          <ProductDetailsCard
            canManageDetails={canManage}
            initialDialogOpen={false}
            organizationId={organizationId}
            product={
              screen === "product-move"
                ? {
                    ...previewProducts[0],
                    description: "A private application for Example Studio.",
                    visibility: "private",
                  }
                : previewProducts[0]
            }
            canManageLifecycle={canManage}
            adopterOrganizations={[{ organizationId: "preview-adopter", name: "Another Studio" }]}
            shareInfo={{
              visibility: screen === "product-move" ? "private" : "public",
              adopterOrganizations: [
                { organizationId: "preview-adopter", name: "Another Studio" },
              ],
            }}
            canTransferPublisher={screen !== "product-move" && isOwner}
            transferOptions={{
              destinations: [{ organizationId: "preview-destination", name: "Another Studio" }],
            }}
            canMoveProduct={screen === "product-move" && isOwner}
            moveOptions={{
              sourceOrganizationId: organizationId,
              destinations:
                screen === "product-move"
                  ? [{ organizationId: "preview-destination", name: "Another Studio" }]
                  : [],
            }}
          />
        </>
      )}
      {screen === "product-people" && (
        <>
          <DashboardHeading description="Manage who can use this product and what they can do." />
          <AddExistingProductMemberSection
            accessRoles={empty ? [] : previewAccessRoles}
            organizationId={organizationId}
            productId="field-notes"
            isProductOwner={isOwner}
          />
          <ProductPeopleSection
            isOwner={isOwner}
            members={empty ? [] : previewMembers}
            organizationId={organizationId}
            productId="field-notes"
          />
          <PendingInvitations
            invitations={
              empty
                ? []
                : [
                    {
                      invitationId: "preview-invite" as InvitationId,
                      email: "jordan@example.test",
                      role: "member",
                      expiresAt: invitationExpiry,
                    },
                  ]
            }
            organizationId={organizationId}
            productId="field-notes"
          />
        </>
      )}
      {screen === "product-access" && (
        <>
          <DashboardHeading description="Review and manage what product members can do." />
          {empty ? (
            <section className="dashboard-empty-card">
              <div>
                <h2>No permissions yet</h2>
                <p>Add permissions when a member needs to use this product.</p>
              </div>
            </section>
          ) : (
            <div className="access-grant-list">
              {previewGrants.map((grant) => (
                <ProductAccessGrantCard
                  key={grant.membershipId}
                  grant={grant}
                  email="alex@example.test"
                  productMember={previewMembers[0]}
                  canManage={canManage}
                  organizationId={organizationId}
                  productId="field-notes"
                />
              ))}
            </div>
          )}
        </>
      )}
      {screen === "product-roles" && (
        <>
          <DashboardHeading description="Manage reusable permission sets for this product." />
          <ProductAccessRoleCatalog
            accessRoles={empty ? [] : previewAccessRoles}
            organizationId={organizationId}
            productId="field-notes"
          />
        </>
      )}
      {screen === "product-clients" && (
        <>
          <DashboardHeading description="Connect Field Notes to Perminister with app client credentials." />
          <ConsumerClientManager
            clients={empty ? [] : [{ ...client, productId: "field-notes" }]}
            organizationId={organizationId}
            productId="field-notes"
            returnTo="/ui-preview"
          />
        </>
      )}
      {screen === "product-keys" && (
        <>
          <DashboardHeading description="Create and manage API keys that work with this product." />
          <ProductApiKeyRecords
            canCreate
            keys={empty ? [] : previewApiKeys}
            now={Date.parse("2026-10-27T00:00:00Z")}
            organizationId={organizationId}
            product={previewProducts[0]}
            returnTo="/ui-preview"
          />
        </>
      )}
      {screen === "product-activity" && (
        <>
          <DashboardHeading description="Recent changes to members, invitations, permissions, and API keys." />
          <ActivityFeed
            entries={empty ? [] : previewProductActivity}
            emptyMessage="Changes to this product will appear here."
          />
        </>
      )}
      {screen === "product-key-new" && (
        <>
          <DashboardHeading description="Choose what this key can do and where it can be used." />
          <ProductApiKeyCreationSection
            canCreate
            canManageAccess
            isEmailVerified
            organizationId={organizationId}
            product={products[0]}
            productId="field-notes"
            returnTo="/ui-preview"
          />
        </>
      )}
      {screen === "client-edit" && (
        <>
          <DashboardHeading description="Edit app client settings." />
          <ConsumerClientSettingsForm
            client={{ ...client, productId: "field-notes" }}
            organizationId={organizationId}
            productId="field-notes"
            returnTo="/ui-preview"
            clientsPath="/ui-preview"
          />
        </>
      )}
    </>
  );
}
