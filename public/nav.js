<svg viewBox="0 0 240 240" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="kinbot mascot">
  <defs>
    <linearGradient id="kbHead" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#9ee8d2"/>
      <stop offset="1" stop-color="#5fc9a9"/>
    </linearGradient>
    <linearGradient id="kbVisor" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1b574f"/>
      <stop offset="1" stop-color="#103f39"/>
    </linearGradient>
    <radialGradient id="kbEye" cx="0.5" cy="0.4" r="0.7">
      <stop offset="0" stop-color="#d7fff3"/>
      <stop offset="1" stop-color="#6fe8c6"/>
    </radialGradient>
    <linearGradient id="kbGlow" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#b6ffe6"/>
      <stop offset="1" stop-color="#66e6c0"/>
    </linearGradient>
    <linearGradient id="kbHair" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#69c2ab"/>
      <stop offset="1" stop-color="#43a690"/>
    </linearGradient>
  </defs>

  <!-- antenna -->
  <line x1="120" y1="40" x2="120" y2="18" stroke="#5cbfa6" stroke-width="6" stroke-linecap="round"/>
  <circle cx="120" cy="13" r="9" fill="url(#kbGlow)">
    <animate attributeName="opacity" values="1;0.5;1" dur="2.4s" repeatCount="indefinite"/>
  </circle>

  <!-- headphone band -->
  <path d="M44 122 A78 78 0 0 1 196 122" fill="none" stroke="#5cbfa6" stroke-width="12" stroke-linecap="round"/>

  <!-- 天然パーマ -->
  <g fill="url(#kbHair)">
    <circle cx="66" cy="64" r="18"/>
    <circle cx="84" cy="50" r="19"/>
    <circle cx="104" cy="42" r="20"/>
    <circle cx="124" cy="39" r="21"/>
    <circle cx="144" cy="43" r="20"/>
    <circle cx="163" cy="52" r="18"/>
    <circle cx="178" cy="66" r="16"/>
    <circle cx="95" cy="62" r="15"/>
    <circle cx="118" cy="58" r="15"/>
    <circle cx="140" cy="60" r="15"/>
  </g>
  <g fill="#8fd9c4" opacity="0.75">
    <circle cx="90" cy="46" r="6"/>
    <circle cx="112" cy="39" r="6"/>
    <circle cx="134" cy="40" r="6"/>
    <circle cx="156" cy="49" r="5"/>
    <circle cx="72" cy="60" r="5"/>
  </g>

  <!-- head -->
  <rect x="52" y="52" width="136" height="114" rx="36" fill="url(#kbHead)"/>

  <!-- ほっぺ（blush） -->
  <ellipse cx="74" cy="126" rx="9" ry="6" fill="#ff9bb0" opacity="0.45"/>
  <ellipse cx="166" cy="126" rx="9" ry="6" fill="#ff9bb0" opacity="0.45"/>

  <!-- visor -->
  <rect x="70" y="80" width="100" height="56" rx="26" fill="url(#kbVisor)"/>

  <!-- 太い眉毛 -->
  <path d="M85 92 Q100 85 114 91" fill="none" stroke="#bff8ea" stroke-width="8" stroke-linecap="round"/>
  <path d="M126 91 Q140 85 155 92" fill="none" stroke="#bff8ea" stroke-width="8" stroke-linecap="round"/>

  <!-- eyes -->
  <circle cx="100" cy="111" r="13" fill="url(#kbEye)">
    <animate attributeName="r" values="13;13;2.5;13;13" dur="5s" keyTimes="0;0.92;0.95;0.98;1" repeatCount="indefinite"/>
  </circle>
  <circle cx="140" cy="111" r="13" fill="url(#kbEye)">
    <animate attributeName="r" values="13;13;2.5;13;13" dur="5s" keyTimes="0;0.92;0.95;0.98;1" repeatCount="indefinite"/>
  </circle>

  <!-- smile -->
  <path d="M103 127 Q120 139 137 127" fill="none" stroke="#7fecce" stroke-width="4" stroke-linecap="round"/>

  <!-- ear cups -->
  <rect x="34" y="104" width="26" height="44" rx="12" fill="#5cbfa6"/>
  <rect x="180" y="104" width="26" height="44" rx="12" fill="#5cbfa6"/>
  <rect x="40" y="112" width="14" height="28" rx="7" fill="#9ee8d2" opacity="0.85"/>
  <rect x="186" y="112" width="14" height="28" rx="7" fill="#9ee8d2" opacity="0.85"/>
</svg>
