import { citationText, type CiteInput } from "../../lib/site/cite";

/** A copy-paste citation for the figure on the page: what, how much, which period, which source, which link. */
export function HowToCite({ cite }: { cite: CiteInput }) {
  return (
    <>
      <h2>How to cite this figure</h2>
      <p>Copy this line when you quote the figure. It names the label, the period, the source and the licence.</p>
      <pre className="selectall">
        <code>{citationText(cite)}</code>
      </pre>
    </>
  );
}
