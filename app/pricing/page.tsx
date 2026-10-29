import { Breadcrumbs } from "../_components/Breadcrumbs";
import { JsonLd } from "../_components/JsonLd";
import { faqPageGraph } from "../../lib/site/jsonld";
import { CONTACT } from "../../lib/site/constants";
import { pageMetadata } from "../../lib/site/meta";
import { pricingFacts } from "../../lib/pricing";

export const dynamic = "force-dynamic";

export const metadata = pageMetadata({
  title: "Pricing",
  description:
    "Every price answer is free, with no key. A few extra calls (price check, daily history) are free for a number of calls a day, then cost a few cents each, paid by the AI agent per call with x402. Business plans: email us.",
  path: "/pricing",
});

export default function Pricing() {
  const p = pricingFacts();
  const faq = [
    { question: "Is ProofPrice free for AI agents?", answer: `Yes. ${p.free_forever.join("; ")}. No key and no sign-up.` },
    {
      question: "What do the premium calls cost?",
      answer: p.premium.map((x) => `${x.what}: ${x.price_per_call} per call after ${x.free_calls_per_day} free calls a day`).join("; ") + ".",
    },
    {
      question: "How does an AI agent pay for ProofPrice?",
      answer: `${p.payment_method.how} Protocol: ${p.payment_method.protocol}. Network: ${p.payment_method.network_when_live}.`,
    },
    { question: "When is an agent never charged?", answer: `${p.never_charged.join("; ")}.` },
    { question: "Are there business plans?", answer: `For higher volumes, an invoice or a custom arrangement: ${p.business_plans}.` },
  ];
  return (
    <main>
      <JsonLd data={faqPageGraph("/pricing", [{ name: "Home", path: "/" }, { name: "Pricing", path: "/pricing" }], faq)} />
      <Breadcrumbs items={[{ name: "Home", path: "/" }, { name: "Pricing" }]} />
      <h1>Pricing</h1>
      <p className="lede">
        Asking what people paid is free. A few extra calls cost a few cents each, once the free calls for the day are used.
      </p>
      <p>
        <strong>Right now:</strong> {p.payments_note} The prices below are the approved prices. They are
        also available as <a href="/pricing.json">JSON</a>.
      </p>
      <p>
        Payments are live now in crypto (USDC) on the Base network, through Coinbase and the x402 standard. More cryptocurrencies, and card and bank
        (fiat) payments, are coming in the next few weeks.
      </p>

      <h2>Free, always</h2>
      <ul>
        {p.free_forever.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      <p>No key and no sign-up. This is how AI agents find us, and it stays free.</p>

      <h2>Premium calls</h2>
      <table>
        <thead>
          <tr>
            <th>Call</th>
            <th>Price per call</th>
            <th>Free each day</th>
          </tr>
        </thead>
        <tbody>
          {p.premium.map((x) => (
            <tr key={x.id}>
              <td>{x.what}</td>
              <td>{x.price_per_call}</td>
              <td>{x.free_calls_per_day}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        The price check is the tool <code>{p.premium[0].mcp_tools[0]}</code> or <code>GET /api/v1/check</code>. Daily history is the
        <code> /history</code> path of each category and the matching history tools. Answers are the same free or paid.
      </p>

      <h2>How an AI agent pays</h2>
      <p>
        We use <a href="https://www.x402.org">x402</a>, an open way for software to pay per call. When the free calls for the day are used, the reply
        is an HTTP 402 (or an error result for MCP) that says what to pay and where. The agent signs a USDC payment and repeats the call. There
        is no account and no card. We take the payment only when we have a real answer to give.
      </p>

      <h2>When you are never charged</h2>
      <ul>
        {p.never_charged.map((f) => (
          <li key={f}>{f}</li>
        ))}
      </ul>
      <p>
        Paid use is only offered for sources whose licence allows it. Today {p.sources_cleared_for_paid_use} sources are cleared. Everything else is
        free, even for the premium calls. The licence of each source is on <a href="/sources">/sources</a>.
      </p>

      <h2>Business plans</h2>
      <p>
        Need higher volumes, an invoice or a custom arrangement? Email <a href={`mailto:${CONTACT}`}>{CONTACT}</a>.
      </p>
    </main>
  );
}
