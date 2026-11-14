// Support page: where to get help. Plain English, no pricing or promotional wording (app directories ask for a support address
// that is only about help). Keep the contact in step with app/terms and app/privacy.
import { pageMetadata } from "../../lib/site/meta";

export const metadata = pageMetadata({
  title: "Support",
  description: "How to get help with ProofPrice: one email address, what to tell us, and where the rules are.",
  path: "/support",
});

export default function Support() {
  return (
    <main>
      <h1>Support</h1>
      <p>
        ProofPrice gives price information from official records, for people and AI agents: what homes sold for, what rent is paid, and
        other recorded prices. It is run by Simon Creedon.
      </p>
      <h2>Get help</h2>
      <p>
        Email <a href="mailto:hello@proofprice.com">hello@proofprice.com</a>.
      </p>
      <p>To help us answer quickly, tell us:</p>
      <ul>
        <li>what you asked (the place, the kind of price, and the app or assistant you used);</li>
        <li>what you got back, or the error message;</li>
        <li>what you expected instead.</li>
      </ul>
      <h2>Common questions</h2>
      <ul>
        <li>
          <strong>A number looks wrong.</strong> Every answer names its official source, its period and how many records it is built from.
          Send us the answer and we will check it against the source.
        </li>
        <li>
          <strong>My place is not covered.</strong> Coverage depends on which official bodies publish open data. See{" "}
          <a href="/sources">the list of sources</a>.
        </li>
        <li>
          <strong>Is this advice?</strong> No. It is information only: not a valuation, and not financial, mortgage or legal advice.
        </li>
        <li>
          <strong>Do you hold personal data about me?</strong> No accounts, no cookies. See the <a href="/privacy">privacy notice</a>.
        </li>
      </ul>
      <p>
        See also: <a href="/terms">Terms of use</a> · <a href="/privacy">Privacy notice</a> · <a href="/method">How the numbers are made</a>
      </p>
    </main>
  );
}
