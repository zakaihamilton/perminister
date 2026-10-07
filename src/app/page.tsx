import Link from "next/link";
import { ArrowRight, SiteFooter, SiteHeader } from "@/components/site-shell";

const capabilities = [
  {
    label: "Organization catalog",
    title: "Keep every product in view",
    text: "Manage organization and product details from one shared workspace.",
  },
  {
    label: "Product teams",
    title: "Make ownership clear",
    text: "Product Owners and Admins manage membership, invitations, and permission grants.",
  },
  {
    label: "Scoped permissions",
    title: "Define the actions people need",
    text: "Grant product, project, or workspace actions, then check them from your server with a scoped API key.",
  },
];

const accessLevels = [
  {
    number: "01",
    title: "Organization",
    text: "Owners and Admins manage organization and product details in the catalog.",
  },
  {
    number: "02",
    title: "Product",
    text: "Product Owners and Admins manage their team, invitations, and explicit grants.",
  },
  {
    number: "03",
    title: "Permission",
    text: "An active grant is required for an action. Product membership alone does not authorize it.",
  },
];

function WelcomeAccessIllustration() {
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

      <rect width="1000" height="760" rx="34" fill="url(#welcome-graphic-background)" />
      <rect width="1000" height="760" rx="34" fill="url(#welcome-graphic-glow)" />
      <rect width="1000" height="760" rx="34" fill="url(#welcome-graphic-grid)" opacity=".38" />
      <circle cx="878" cy="193" r="118" fill="#6da7df" fillOpacity=".07" />
      <circle cx="118" cy="635" r="148" fill="#72c7aa" fillOpacity=".07" />
      <path
        d="M16 240h18m-9-9v18m928 312h18m-9-9v18"
        stroke="#b9d7f3"
        strokeOpacity=".38"
        strokeWidth="2"
        strokeLinecap="round"
      />

      <g filter="url(#welcome-graphic-shadow)">
        <rect x="54" y="54" width="892" height="590" rx="22" fill="#f7f9fc" />
      </g>
      <g clipPath="url(#welcome-graphic-window)">
        <rect x="54" y="54" width="892" height="72" fill="#fff" />
        <path d="M54 126h892" stroke="#e2e8f0" />
        <rect x="76" y="68" width="42" height="42" rx="13" fill="#1b3554" />
        <path d="m97 76 12 5v9c0 7-5 12-12 15-7-3-12-8-12-15v-9l12-5Z" fill="#d9e9f7" />
        <path
          d="m92 89 4 4 7-8"
          fill="none"
          stroke="#3f76ae"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <rect x="131" y="75" width="130" height="12" rx="6" fill="#20354d" />
        <rect x="131" y="94" width="84" height="7" rx="3.5" fill="#a6b5c6" />
        <rect x="772" y="73" width="111" height="34" rx="17" fill="#f1f5f9" />
        <circle className="welcome-graphic-status-halo" cx="791" cy="90" r="9" fill="#48a77c" />
        <circle cx="791" cy="90" r="5" fill="#48a77c" />
        <rect x="803" y="86" width="61" height="8" rx="4" fill="#728398" />
        <circle cx="909" cy="90" r="19" fill="#dbe8f4" />
        <path d="M900 96c1-5 4-7 9-7s8 2 9 7" fill="#4577a6" />
        <circle cx="909" cy="84" r="4" fill="#4577a6" />

        <rect x="54" y="126" width="176" height="518" fill="#f0f4f9" />
        <path d="M230 126v518" stroke="#e1e7ef" />
        <rect x="72" y="151" width="140" height="42" rx="11" fill="#dce9f7" />
        <rect x="85" y="164" width="15" height="15" rx="4" fill="#477bad" />
        <path d="M89 168h7m-7 4h7m-7 4h5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
        <rect x="109" y="167" width="82" height="8" rx="4" fill="#315b83" />
        <rect x="86" y="215" width="16" height="16" rx="5" fill="#c5d2e0" />
        <path d="M90 223h8m-4-4v8" stroke="#6c7f94" strokeWidth="1.5" strokeLinecap="round" />
        <rect x="111" y="219" width="72" height="7" rx="3.5" fill="#8696a8" />
        <rect x="86" y="258" width="16" height="16" rx="5" fill="#c5d2e0" />
        <circle cx="94" cy="266" r="4" fill="none" stroke="#6c7f94" strokeWidth="1.5" />
        <rect x="111" y="262" width="62" height="7" rx="3.5" fill="#8696a8" />
        <rect x="86" y="301" width="16" height="16" rx="5" fill="#c5d2e0" />
        <path
          d="m91 308 3 3 5-6"
          fill="none"
          stroke="#6c7f94"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <rect x="111" y="305" width="76" height="7" rx="3.5" fill="#8696a8" />
        <path d="M75 356h134" stroke="#dbe2eb" />
        <rect x="86" y="380" width="16" height="16" rx="5" fill="#d7e0ea" />
        <circle cx="94" cy="385" r="3" fill="none" stroke="#718399" strokeWidth="1.4" />
        <path
          d="M89 394c1-3 3-4 5-4s4 1 5 4"
          fill="none"
          stroke="#718399"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        <rect x="111" y="384" width="67" height="7" rx="3.5" fill="#8696a8" />
        <rect x="86" y="423" width="16" height="16" rx="5" fill="#d7e0ea" />
        <path
          d="m90 431 4-4 4 4-4 4-4-4Z"
          fill="none"
          stroke="#718399"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <rect x="111" y="427" width="58" height="7" rx="3.5" fill="#8696a8" />

        <rect x="230" y="126" width="716" height="518" fill="#f7f9fc" />
        <rect x="264" y="154" width="225" height="18" rx="9" fill="#21384f" />
        <rect x="264" y="181" width="172" height="8" rx="4" fill="#9aa9b9" />
        <rect x="788" y="151" width="124" height="34" rx="17" fill="#e2f1ea" />
        <circle cx="807" cy="168" r="5" fill="#3b9d72" />
        <rect x="820" y="164" width="75" height="8" rx="4" fill="#438363" />

        <rect x="264" y="208" width="202" height="102" rx="13" fill="#fff" stroke="#e1e7ef" />
        <rect x="280" y="226" width="38" height="38" rx="11" fill="#e6f0fb" />
        <rect x="292" y="238" width="14" height="14" rx="4" fill="#4c83b6" />
        <path d="M289 269h20" stroke="#adc7df" strokeWidth="2" strokeLinecap="round" />
        <text
          x="329"
          y="253"
          fill="#263d55"
          fontFamily="Arial, sans-serif"
          fontSize="32"
          fontWeight="700"
        >
          12
        </text>
        <rect x="330" y="270" width="93" height="7" rx="3.5" fill="#9aaabd" />
        <rect x="330" y="284" width="65" height="5" rx="2.5" fill="#d3dce6" />

        <rect x="480" y="208" width="202" height="102" rx="13" fill="#fff" stroke="#e1e7ef" />
        <rect x="496" y="226" width="38" height="38" rx="11" fill="#e5f3ee" />
        <circle cx="515" cy="239" r="6" fill="#4a9b7c" />
        <path d="M503 256c2-6 6-9 12-9s10 3 12 9" fill="#4a9b7c" />
        <text
          x="545"
          y="253"
          fill="#263d55"
          fontFamily="Arial, sans-serif"
          fontSize="32"
          fontWeight="700"
        >
          48
        </text>
        <rect x="546" y="270" width="86" height="7" rx="3.5" fill="#9aaabd" />
        <rect x="546" y="284" width="60" height="5" rx="2.5" fill="#d3dce6" />

        <rect x="696" y="208" width="216" height="102" rx="13" fill="#fff" stroke="#e1e7ef" />
        <rect x="712" y="226" width="38" height="38" rx="11" fill="#f3ecdf" />
        <path
          d="M725 236h12v17h-12zM728 232h6v4h-6z"
          fill="none"
          stroke="#a77a39"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <text
          x="760"
          y="253"
          fill="#263d55"
          fontFamily="Arial, sans-serif"
          fontSize="32"
          fontWeight="700"
        >
          03
        </text>
        <rect x="761" y="270" width="99" height="7" rx="3.5" fill="#9aaabd" />
        <rect x="761" y="284" width="58" height="5" rx="2.5" fill="#d3dce6" />

        <rect x="264" y="330" width="420" height="282" rx="15" fill="#fff" stroke="#e1e7ef" />
        <rect x="284" y="350" width="149" height="11" rx="5.5" fill="#31475e" />
        <rect x="284" y="370" width="105" height="6" rx="3" fill="#b1bdca" />
        <path
          d="M398 489h31m0-71v140m0-140h27m-27 70h27m-27 70h27"
          fill="none"
          stroke="#97b5d1"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="429" cy="489" r="5" fill="#5d93bf" />
        <rect x="284" y="447" width="114" height="84" rx="12" fill="#f0f5fa" stroke="#dce5ee" />
        <rect x="300" y="462" width="34" height="34" rx="9" fill="#dce9f7" />
        <path
          d="M317 469v19m-8-14 8-5 8 5v9l-8 5-8-5v-9Z"
          fill="none"
          stroke="#4679a8"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <rect x="344" y="466" width="41" height="6" rx="3" fill="#73879b" />
        <rect x="344" y="479" width="31" height="5" rx="2.5" fill="#bdc9d5" />
        <circle cx="309" cy="513" r="4" fill="#64af8c" />
        <rect x="320" y="510" width="65" height="5" rx="2.5" fill="#a4b2c0" />

        <rect x="457" y="392" width="205" height="52" rx="10" fill="#fbfcfe" stroke="#e2e9f1" />
        <rect x="470" y="402" width="32" height="32" rx="9" fill="#e5effa" />
        <path
          d="M479 411h14v14h-14zM483 407h14v14"
          fill="none"
          stroke="#4c7fae"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <rect x="512" y="407" width="76" height="6" rx="3" fill="#556b81" />
        <rect x="512" y="420" width="50" height="5" rx="2.5" fill="#b3bfcc" />
        <circle cx="641" cy="418" r="6" fill="#5bb287" />
        <path
          d="m638 418 2 2 4-5"
          fill="none"
          stroke="#fff"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        <rect x="457" y="462" width="205" height="52" rx="10" fill="#fbfcfe" stroke="#e2e9f1" />
        <rect x="470" y="472" width="32" height="32" rx="9" fill="#e5f3ee" />
        <path
          d="M479 482h14v12h-14zM483 478h14v12"
          fill="none"
          stroke="#4d9479"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <rect x="512" y="477" width="87" height="6" rx="3" fill="#556b81" />
        <rect x="512" y="490" width="59" height="5" rx="2.5" fill="#b3bfcc" />
        <circle cx="641" cy="488" r="6" fill="#5bb287" />
        <path
          d="m638 488 2 2 4-5"
          fill="none"
          stroke="#fff"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        <rect x="457" y="532" width="205" height="52" rx="10" fill="#fbfcfe" stroke="#e2e9f1" />
        <rect x="470" y="542" width="32" height="32" rx="9" fill="#f2ecdf" />
        <path
          d="M480 549h12v18h-12zM483 546h6v3"
          fill="none"
          stroke="#9d7846"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
        <rect x="512" y="547" width="71" height="6" rx="3" fill="#556b81" />
        <rect x="512" y="560" width="48" height="5" rx="2.5" fill="#b3bfcc" />
        <circle cx="641" cy="558" r="6" fill="#5bb287" />
        <path
          d="m638 558 2 2 4-5"
          fill="none"
          stroke="#fff"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        <rect x="704" y="330" width="208" height="282" rx="15" fill="#fff" stroke="#e1e7ef" />
        <rect x="724" y="350" width="119" height="11" rx="5.5" fill="#31475e" />
        <rect x="724" y="370" width="88" height="6" rx="3" fill="#b1bdca" />
        <circle cx="808" cy="437" r="42" fill="#e8f3ee" />
        <circle cx="808" cy="437" r="31" fill="#4c9e78" />
        <path
          d="m794 437 9 9 19-21"
          fill="none"
          stroke="#fff"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M725 500h166" stroke="#e6ebf1" />
        <circle cx="741" cy="528" r="11" fill="#dce9f7" />
        <path d="M736 530c1-4 3-6 5-6s4 2 5 6" fill="#4a7cab" />
        <circle cx="741" cy="524" r="3" fill="#4a7cab" />
        <rect x="761" y="522" width="69" height="6" rx="3" fill="#62778b" />
        <rect x="761" y="535" width="47" height="5" rx="2.5" fill="#b7c2cd" />
        <circle cx="875" cy="530" r="10" fill="#e3f2ea" />
        <path
          d="m871 530 3 3 5-6"
          fill="none"
          stroke="#459a70"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="741" cy="570" r="11" fill="#e5ecf3" />
        <path d="M736 572c1-4 3-6 5-6s4 2 5 6" fill="#70859a" />
        <circle cx="741" cy="566" r="3" fill="#70859a" />
        <rect x="761" y="564" width="80" height="6" rx="3" fill="#62778b" />
        <rect x="761" y="577" width="52" height="5" rx="2.5" fill="#b7c2cd" />
        <circle cx="875" cy="572" r="10" fill="#e3f2ea" />
        <path
          d="m871 572 3 3 5-6"
          fill="none"
          stroke="#459a70"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>

      <g filter="url(#welcome-graphic-card-shadow)">
        <rect x="711" y="615" width="248" height="91" rx="16" fill="#fff" />
        <rect x="729" y="633" width="48" height="48" rx="14" fill="#e7f0fa" />
        <path d="m753 640 13 5v9c0 8-5 13-13 16-8-3-13-8-13-16v-9l13-5Z" fill="#4d82b3" />
        <path
          d="m747 654 4 4 8-9"
          fill="none"
          stroke="#fff"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <rect x="791" y="641" width="124" height="8" rx="4" fill="#344a60" />
        <rect x="791" y="658" width="89" height="6" rx="3" fill="#aab7c5" />
        <circle cx="798" cy="679" r="4" fill="#5aae84" />
        <rect x="809" y="676" width="73" height="6" rx="3" fill="#7890a5" />
      </g>

      <circle cx="55" cy="680" r="4" fill="#80c6a8" />
      <circle cx="72" cy="680" r="4" fill="#6da7df" />
      <circle cx="89" cy="680" r="4" fill="#d2b47a" />
      <path
        d="M109 680h91"
        stroke="#b9d7f3"
        strokeOpacity=".42"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function HomePage() {
  return (
    <div className="home-page">
      <SiteHeader active="home" />
      <main className="page-shell home-page-main">
        <section className="container welcome-hero" aria-labelledby="home-title">
          <div className="welcome-hero-copy">
            <p className="eyebrow">For organization owners and admins</p>
            <h1 id="home-title">A clearer view of every product and permission.</h1>
            <p className="welcome-hero-lede">
              Bring organization details, product teams, and scoped access together in one
              workspace, so ownership stays clear as your catalog grows.
            </p>
            <div className="hero-actions welcome-hero-actions">
              <Link className="button button-primary" href="/register">
                Create an account <ArrowRight />
              </Link>
              <Link className="button button-secondary" href="/developers">
                Explore the developer guide
              </Link>
            </div>
          </div>

          <figure className="welcome-hero-figure">
            <WelcomeAccessIllustration />
          </figure>
        </section>

        <section className="container home-benefits" aria-labelledby="home-benefits-title">
          <header className="home-section-heading">
            <p className="eyebrow">A clear operating model</p>
            <h2 id="home-benefits-title">
              Keep the catalog clear. Let each product manage its team.
            </h2>
            <p>
              Organization Owners and Admins manage organization and product details. Product teams
              handle collaboration, while explicit grants define the actions a member can take.
            </p>
          </header>
          <div className="home-benefit-grid">
            {capabilities.map((capability) => (
              <article className="home-benefit-card" key={capability.label}>
                <p className="home-card-label">{capability.label}</p>
                <h3>{capability.title}</h3>
                <p>{capability.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="container home-access-section" aria-labelledby="home-access-title">
          <header className="home-section-heading home-access-heading">
            <p className="eyebrow">How access stays clear</p>
            <h2 id="home-access-title">Put each decision at the right level.</h2>
            <p>
              Perminister centralizes identity and permission records. Each product keeps its own
              sessions, domain data, and final resource checks.
            </p>
          </header>
          <div className="home-access-grid">
            {accessLevels.map((level) => (
              <article className="home-access-card" key={level.number}>
                <span className="home-access-number">{level.number}</span>
                <h3>{level.title}</h3>
                <p>{level.text}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="container home-closing-cta" aria-labelledby="home-cta-title">
          <div>
            <p className="home-cta-label">Start with your organization</p>
            <h2 id="home-cta-title">Make product access easier to oversee.</h2>
            <p>
              Request or manage your organization workspace and bring products, teams, and access
              together.
            </p>
          </div>
          <Link className="button home-closing-button" href="/dashboard">
            Open dashboard <ArrowRight />
          </Link>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
