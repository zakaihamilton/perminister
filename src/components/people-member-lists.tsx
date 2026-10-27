"use client";

import type { ReactNode } from "react";
import { ClientFilteredList } from "@/components/client-filtered-list";
import { ConfirmationActionControl } from "@/components/confirmation-action-control";
import { CustomDropdown } from "@/components/custom-dropdown";
import { ProductMemberRemoveControl } from "@/components/product-member-remove-control";
import type { OrganizationMemberView, ProductMemberView } from "@/lib/auth/service";

type SearchableMember = {
  email: string | null;
  membership: { role: string };
};

function memberMatchesQuery(member: SearchableMember, query: string): boolean {
  const email = member.email?.toLowerCase() ?? "";
  return email.includes(query) || member.membership.role.toLowerCase().includes(query);
}

function MemberSection<T extends SearchableMember>({
  heading,
  members,
  ariaLabel,
  emptyMessage,
  renderItem,
}: {
  heading: string;
  members: readonly T[];
  ariaLabel: string;
  emptyMessage: string;
  renderItem: (member: T) => ReactNode;
}) {
  return (
    <section className="dashboard-card people-card">
      <div className="dashboard-card-heading">
        <div>
          <h2>{heading}</h2>
          <p>
            {members.length} active {members.length === 1 ? "member" : "members"}
          </p>
        </div>
      </div>
      <div className="people-list">
        <ClientFilteredList
          items={members}
          placeholder="Filter members by name or email..."
          ariaLabel={ariaLabel}
          emptyMessage={emptyMessage}
          noItemsMessage={
            heading === "Product members"
              ? "No product members yet."
              : "No organization members yet."
          }
          filterFn={memberMatchesQuery}
          renderItem={renderItem}
        />
      </div>
    </section>
  );
}

function OrganizationMemberRow({
  currentSubjectId,
  member,
  organizationId,
  owner,
}: {
  currentSubjectId: string;
  member: OrganizationMemberView;
  organizationId: string;
  owner: boolean;
}) {
  const membershipId = member.membership.organizationMembershipId;

  return (
    <article className="people-row">
      <div className="people-avatar" aria-hidden="true">
        {(member.email ?? "?").slice(0, 1).toUpperCase()}
      </div>
      <div className="people-identity">
        <strong>{member.email ?? "Account unavailable"}</strong>
        <small>{member.emailVerified ? "Verified email" : "Email not verified"}</small>
      </div>
      <span className={`role-pill role-${member.membership.role}`}>
        {member.membership.role.charAt(0).toUpperCase() + member.membership.role.slice(1)}
      </span>
      {owner ? (
        <div className="people-row-actions">
          <form action="/actions/updateOrganizationMemberRoleAction" method="post">
            <input type="hidden" name="organizationId" value={organizationId} />
            <input type="hidden" name="membershipId" value={membershipId} />
            <label className="visually-hidden" htmlFor={`role-${membershipId}`}>
              Role for {member.email}
            </label>
            <CustomDropdown
              aria-label={`Role for ${member.email}`}
              id={`role-${membershipId}`}
              name="role"
              defaultValue={member.membership.role}
              className="people-role-dropdown"
              options={[
                { value: "owner", label: "Owner" },
                { value: "admin", label: "Admin" },
              ]}
            />
            <button className="button button-secondary" type="submit">
              Save role
            </button>
          </form>
          {member.membership.subjectId !== currentSubjectId ? (
            <ConfirmationActionControl
              action="/actions/removeOrganizationMemberAction"
              fields={[
                { name: "organizationId", value: organizationId },
                { name: "membershipId", value: membershipId },
              ]}
              triggerLabel="Remove member"
              title={`Remove ${member.email ?? "this member"} from the organization?`}
              description="They will lose their organization membership and access through it. You can invite them again later."
              confirmLabel="Remove member"
            />
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function ProductMemberRow({
  isOwner,
  member,
  organizationId,
  productId,
}: {
  isOwner: boolean;
  member: ProductMemberView;
  organizationId: string;
  productId: string;
}) {
  const { membership, email, emailVerified } = member;

  return (
    <article className="people-row">
      <div className="people-avatar" aria-hidden="true">
        {(email ?? "?").slice(0, 1).toUpperCase()}
      </div>
      <div className="people-identity">
        <strong>{email ?? "Account unavailable"}</strong>
        <small>{emailVerified ? "Verified email" : "Email not verified"}</small>
      </div>
      <span className={`role-pill role-${membership.role}`}>{membership.role}</span>
      {isOwner ? (
        <div className="people-row-actions">
          <form action="/actions/updateProductMemberRoleAction" method="post">
            <input type="hidden" name="organizationId" value={organizationId} />
            <input type="hidden" name="productId" value={productId} />
            <input type="hidden" name="subjectId" value={membership.subjectId} />
            <label className="visually-hidden" htmlFor={`product-role-${membership.subjectId}`}>
              Product role for {email}
            </label>
            <CustomDropdown
              aria-label={`Product role for ${email}`}
              id={`product-role-${membership.subjectId}`}
              name="role"
              defaultValue={membership.role}
              className="people-role-dropdown"
              options={[
                { value: "owner", label: "Owner" },
                { value: "admin", label: "Admin" },
                { value: "member", label: "Member" },
              ]}
            />
            <button className="button button-secondary" type="submit">
              Save role
            </button>
          </form>
          <ProductMemberRemoveControl
            organizationId={organizationId}
            productId={productId}
            subjectId={membership.subjectId}
            memberLabel={email ?? "this member"}
          />
        </div>
      ) : null}
    </article>
  );
}

export function OrganizationPeopleMemberList({
  currentSubjectId,
  members,
  organizationId,
  owner,
}: {
  currentSubjectId: string;
  members: OrganizationMemberView[];
  organizationId: string;
  owner: boolean;
}) {
  return (
    <MemberSection
      heading="Organization members"
      members={members}
      ariaLabel="Filter organization members"
      emptyMessage="No members match your filter."
      renderItem={(member) => (
        <OrganizationMemberRow
          key={member.membership.organizationMembershipId}
          currentSubjectId={currentSubjectId}
          member={member}
          organizationId={organizationId}
          owner={owner}
        />
      )}
    />
  );
}

export function ProductPeopleMemberList({
  isOwner,
  members,
  organizationId,
  productId,
}: {
  isOwner: boolean;
  members: ProductMemberView[];
  organizationId: string;
  productId: string;
}) {
  return (
    <MemberSection
      heading="Product members"
      members={members}
      ariaLabel="Filter product members"
      emptyMessage="No product members match your filter."
      renderItem={(member) => (
        <ProductMemberRow
          key={member.membership.organizationMembershipId}
          isOwner={isOwner}
          member={member}
          organizationId={organizationId}
          productId={productId}
        />
      )}
    />
  );
}
