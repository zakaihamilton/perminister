export function IllustrationBackdrop() {
  return (
    <>
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
    </>
  );
}

export function IllustrationWindowFrame() {
  return (
    <>
      <g filter="url(#welcome-graphic-shadow)">
        <rect x="54" y="54" width="892" height="590" rx="22" fill="#f7f9fc" />
      </g>
    </>
  );
}

export function IllustrationNavigation() {
  return (
    <>
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
    </>
  );
}

export function IllustrationFooter() {
  return (
    <>
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
    </>
  );
}
