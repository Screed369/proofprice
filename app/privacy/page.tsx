// Privacy notice. Plain English, matching what the code does (see lib/receipts and app/api). Version history in git.
import { pageMetadata } from "../../lib/site/meta";
import { usageEnabled } from "../../lib/usage";

// Rendered on request, so the usage-counting paragraph appears only while counting is actually on (same check as lib/usage.ts).
export const dynamic = "force-dynamic";

export const metadata = pageMetadata({
  title: "Privacy notice",
  description: "What ProofPrice collects (very little), why, who else sees it, and your rights.",
  path: "/privacy",
});

export default function Privacy() {
  const counting = usageEnabled();
  return (
    <main>
      <h1>Privacy notice</h1>
      <p>
        <em>Version 1.1, 21 October 2026.</em>
      </p>

      <h2>Who we are</h2>
      <p>
        ProofPrice (proofprice.com) is run by Simon Creedon. Contact: <a href="mailto:hello@proofprice.com">hello@proofprice.com</a>.
      </p>

      <h2>What we collect</h2>
      <ul>
        <li>
          When you or your AI agent asks a price question, we receive what was asked (for example a town, postcode or fuel type) and
          technical details that every web request carries: IP address, time, the address requested and the name of the software.
        </li>
        <li>We use the question only to find the answer. We do not ask who you are, there are no accounts, and we set no cookies.</li>
        <li>
          If you send an email to our receipt checker, we read it in memory to check its digital seal and return the receipt facts
          (shop, date, amounts). We do not keep the email, and we do not keep the facts we return.
        </li>
      </ul>

      {counting && (
        <>
          <h2>Anonymous usage counts</h2>
          <p>
            To see which questions ProofPrice cannot answer yet, and how many apps and visitors use it, we keep aggregate counts. For each
            question we add one to a daily counter for: the day, the tool or endpoint used, the country asked about, the place and item asked
            about (in lower case, at most 60 characters, with a postcode cut to its first part), whether it was answered and, if your AI app
            sends it when it connects, the name of the app.
          </p>
          <p>
            To count how many different visitors we had each day, we turn your IP address and the name of your software (user agent) into a
            one-way hash, mixed with a random value that is created each day. The hash is used only to count distinct visitors that day.
            Shortly after the day ends (UTC) we keep only the totals and delete the hashes and that day&apos;s random value, so the hash cannot be traced back
            to you or linked to another day.
          </p>
          <p>
            We do not store IP addresses, user agents, the price you ask us to check, free text or anything else that identifies you. The counts are
            kept in our private Vercel Blob storage, and their totals over the last 30 days are public at <a href="/api/v1/usage">/api/v1/usage</a>.
            Our legal basis is our legitimate interest in measuring how the service is used, so we can improve it and cover the prices people
            need.
          </p>
        </>
      )}

      <h2>What we do not do</h2>
      <p>
        We do not sell data, build profiles, show ads or track you across sites. We never return the address of an individual home sale:
        home-sale answers are aggregates (median, range and count) only.
      </p>

      <h2>Why we may use it (legal basis)</h2>
      <p>
        To answer your request and to keep the service working and secure. Under data protection law (GDPR) this is our legitimate interest
        in running a free public information service.
      </p>

      <h2>Who else sees it</h2>
      <ul>
        <li>
          Our hosting provider, Vercel, processes requests for us and keeps standard server logs for the period it sets (see{" "}
          <a href="https://vercel.com/legal/privacy-policy">Vercel&apos;s privacy policy</a>).
        </li>
        <li>
          To answer, we may pass your search terms (such as a town or postcode) to the official public data publisher concerned, for example a
          land registry or a fuel price service. We do not pass on your IP address ourselves.
        </li>
        <li>We store our code and our daily library of aggregate prices on GitHub. It contains no personal data.</li>
        <li>
          Vercel and GitHub are US-based providers. Transfers rely on the safeguards they offer, such as the EU Standard Contractual Clauses.
        </li>
      </ul>

      <h2>How long</h2>
      <p>
        {counting
          ? "We keep no record of individual questions ourselves, only the anonymous daily counts described above. The daily visitor hashes are deleted shortly after the day ends. "
          : "We keep nothing about your questions ourselves. "}
        Our host&apos;s logs are kept for the short period our host sets.
      </p>

      <h2>Your rights</h2>
      <p>
        Where data protection law gives you rights (for example in the EU or UK: to access, correct or delete your data, or to object),
        write to <a href="mailto:hello@proofprice.com">hello@proofprice.com</a> and we will answer within one month. You can also complain
        to a data protection authority, such as Ireland&apos;s Data Protection Commission or the one where you live.
      </p>

      <h2>Children</h2>
      <p>The service is not meant for children.</p>

      <h2>Changes</h2>
      <p>If something changes we will update this page and its date.</p>

      <p>
        See also: <a href="/terms">Terms of use</a> · <a href="/method">How the numbers are made</a>
      </p>
    </main>
  );
}
