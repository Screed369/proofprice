/** The ProofPrice mark: a check (proof) over a price-range whisker with an amber median dot. Same shapes as public/logo.svg. */
export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="15" fill="#0F5C54" />
      <path d="M15.5 27L26 37.5L45.5 13" fill="none" stroke="#FFFFFF" strokeWidth="7.5" strokeLinecap="round" strokeLinejoin="round" />
      <path
        d="M14 52.5H50M14 48V57M50 48V57"
        fill="none"
        stroke="#FFFFFF"
        strokeOpacity=".6"
        strokeWidth="3.2"
        strokeLinecap="round"
      />
      <circle cx="35" cy="52.5" r="5" fill="#F2B84B" />
    </svg>
  );
}
