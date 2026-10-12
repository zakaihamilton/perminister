import {
  IllustrationBackdrop,
  IllustrationFooter,
  IllustrationNavigation,
  IllustrationWindowFrame,
} from "./welcome-access-illustration-parts/layout";
import {
  IllustrationMainHeading,
  IllustrationMetrics,
} from "./welcome-access-illustration-parts/overview";
import { IllustrationProductAccess } from "./welcome-access-illustration-parts/product-access";
import { IllustrationPermissionSummary } from "./welcome-access-illustration-parts/permission-summary";
import { IllustrationSecurityCard } from "./welcome-access-illustration-parts/security-card";

export function WelcomeAccessIllustration() {
  return (
    <svg
      aria-describedby="welcome-graphic-description"
      aria-label="Organization access overview"
      className="welcome-hero-illustration"
      focusable="false"
      height="760"
      role="img"
      viewBox="0 0 1000 760"
      width="1000"
      xmlns="http://www.w3.org/2000/svg"
    >
      <desc id="welcome-graphic-description">
        A workspace dashboard groups an organization, its products, team members, and protected
        permissions.
      </desc>
      <defs>
        <linearGradient id="welcome-graphic-background" x1="60" x2="920" y1="0" y2="760">
          <stop stopColor="#1c3655" />
          <stop offset="1" stopColor="#101d30" />
        </linearGradient>
        <radialGradient
          id="welcome-graphic-glow"
          cx="0"
          cy="0"
          r="1"
          gradientTransform="matrix(550 410 -440 590 80 70)"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#5d94ce" stopOpacity=".34" />
          <stop offset="1" stopColor="#5d94ce" stopOpacity="0" />
        </radialGradient>
        <pattern id="welcome-graphic-grid" width="34" height="34" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1" fill="#b9d7f3" fillOpacity=".16" />
        </pattern>
        <filter id="welcome-graphic-shadow" width="1.25" height="1.35" x="-.12" y="-.12">
          <feGaussianBlur in="SourceAlpha" stdDeviation="13" />
          <feOffset dy="16" />
          <feComponentTransfer>
            <feFuncA slope=".24" type="linear" />
          </feComponentTransfer>
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="welcome-graphic-card-shadow" width="1.3" height="1.4" x="-.15" y="-.2">
          <feGaussianBlur in="SourceAlpha" stdDeviation="7" />
          <feOffset dy="8" />
          <feComponentTransfer>
            <feFuncA slope=".16" type="linear" />
          </feComponentTransfer>
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <clipPath id="welcome-graphic-window">
          <rect x="54" y="54" width="892" height="590" rx="22" />
        </clipPath>
      </defs>

      <IllustrationBackdrop />
      <IllustrationWindowFrame />
      <g clipPath="url(#welcome-graphic-window)">
        <IllustrationNavigation />
        <IllustrationMainHeading />
        <IllustrationMetrics />
        <IllustrationProductAccess />
        <IllustrationPermissionSummary />
      </g>
      <IllustrationSecurityCard />
      <IllustrationFooter />
    </svg>
  );
}
