import Link from "next/link";
import { DeveloperGuideLayout } from "@/components/developer-guide-layout";
import {
  PermissionEnforcementPanel,
  PermissionGuidanceAside,
  PermissionScopePanel,
} from "@/components/permission-guide-sections";

export default function PermissionsPage() {
  return (
    <DeveloperGuideLayout
      active="permissions"
      eyebrow="Developer guide / Permissions"
      title="Grant access in context"
      intro="Perminister grants are scoped to an organization and one of its products, then optionally to a project or workspace. The consumer app still enforces each decision on its server."
    >
      <div className="guide-grid">
        <div className="guide-main">
          <PermissionScopePanel />
          <PermissionEnforcementPanel />
        </div>
        <PermissionGuidanceAside />
      </div>
      <p className="guide-next-link">
        Next: <Link href="/developers/api-keys">handle API keys safely</Link>.
      </p>
    </DeveloperGuideLayout>
  );
}
