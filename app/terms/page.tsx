// Terms of use for the public API and MCP server. Plain English. Version history in git.
export const metadata = {
  title: "Terms of use · ProofPrice",
  description: "Free use for people and AI agents, cite the source, fair use, no guarantees, Irish law.",
  alternates: { canonical: "https://proofprice.com/terms" },
};

export default function Terms() {
  return (
    <main>
      <h1>Terms of use</h1>
      <p>
        <em>Version 1.0, 14 October 2026. ProofPrice is run by Simon Creedon. Contact: <a href="mailto:hello@proofprice.com">hello@proofprice.com</a>.</em>
      </p>
      <ol>
        <li>
          <strong>What this is.</strong> ProofPrice gives price information from official records, for people and AI agents. It is
          information only. It is not a valuation, financial advice, an offer to buy or sell, or a quote.
        </li>
        <li>
          <strong>Free use.</strong> You may use the website, the REST API and the MCP server for free, including inside apps and AI tools,
          without a key. Please keep to fair use: a normal number of requests, no attacks, and no attempts to get around limits. We may slow
          down or block abusive use.
        </li>
        <li>
          <strong>Cite the source.</strong> When you show a figure, show the source and the attribution line we return with it. The data
          comes from official publishers under their own licences (for example the Open Government Licence v3.0, Licence Ouverte 2.0, the
          Italian Open Data Licence 2.0, the Singapore Open Data Licence and CC BY 4.0). Those licences also apply to you when you reuse the
          data.
        </li>
        <li>
          <strong>No guarantees.</strong> Data can be late, incomplete or wrong, because we pass on what publishers release. Fuel figures are
          posted pump prices, not receipts. Home figures are recorded sale prices. We do our best, but we make no promise of accuracy,
          availability or fitness for a purpose. Do not rely on a figure alone for a big decision.
        </li>
        <li>
          <strong>Liability.</strong> As far as the law allows, we are not liable for losses that come from using the service. Nothing in
          these terms limits liability that cannot be limited by law, or takes away rights you have as a consumer.
        </li>
        <li>
          <strong>Receipt checker.</strong> If you send us an email, you confirm it is yours or that you have the right to send it. Do not
          send other people&apos;s private emails. We check it in memory and do not keep it.
        </li>
        <li>
          <strong>No re-identification.</strong> Do not try to identify people from our figures, or combine them with other data to find
          individuals.
        </li>
        <li>
          <strong>Changes.</strong> We may change or stop the service or these terms. The date at the top shows the current version.
        </li>
        <li>
          <strong>Law.</strong> These terms are governed by the laws of Ireland, and the courts of Ireland deal with disputes. If you are a
          consumer, you also keep the protection of the laws where you live.
        </li>
        <li>
          <strong>Contact.</strong> <a href="mailto:hello@proofprice.com">hello@proofprice.com</a>
        </li>
      </ol>
      <p>
        See also: <a href="/privacy">Privacy notice</a> · <a href="/method">How the numbers are made</a>
      </p>
    </main>
  );
}
