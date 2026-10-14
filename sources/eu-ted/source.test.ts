import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTedQuery, collect, COUNTRIES, euTedContracts, INFO, isRetryable, MIN_VALUE, parseTedNotice, pickCurrency, unitName, CORE_FIELDS } from "./source";
import { SourceError, InputError } from "../../lib/http";
import { cpvStem } from "../../categories/contracts/purchases";

// Notices below are copied from live TED Search API v3 responses (POST https://api.ted.europa.eu/v3/notices/search, form-type = result,
// fields = CORE_FIELDS + quantity-lot + quantity-unit-lot; the two Polish ones were fetched without publication-date and the quantity fields),
// checked on 2026-10-14. Only the `links` object that TED adds to every notice is left out. Tests marked "synthetic" change a real notice on purpose.
const FR_512887 = {"publication-number":"512887-2026","main-classification-lot":["30213100","30213100"],"framework-agreement-lot":["fa-wo-rc","fa-wo-rc"],"total-value-cur":["EUR"],"result-lot-identifier":["LOT-0001","LOT-0002"],"total-value":3040000,"tender-value-cur":["EUR"],"tender-value":["185249.2","62530"],"winner-selection-status":["selec-w","selec-w"],"publication-date":"2026-07-24+02:00","identifier-lot":["LOT-0001","LOT-0002"],"tender-lot-identifier":["LOT-0001","LOT-0002"]};
const FR_504855 = {"publication-number":"504855-2026","main-classification-lot":["30213100"],"framework-agreement-lot":["fa-w-rc"],"total-value-cur":["EUR"],"result-lot-identifier":["LOT-0001"],"total-value":25000000,"tender-value-cur":["EUR"],"tender-value":["14365404"],"winner-selection-status":["selec-w"],"publication-date":"2026-07-21+02:00","identifier-lot":["LOT-0001"],"tender-lot-identifier":["LOT-0001"]};
const FR_434580 = {"publication-number":"434580-2026","main-classification-lot":["30213100"],"winner-selection-status":["selec-w"],"framework-agreement-lot":["fa-wo-rc"],"total-value-cur":["EUR"],"publication-date":"2026-06-25+02:00","result-lot-identifier":["LOT-0000"],"identifier-lot":["LOT-0000"],"total-value":20830000,"tender-lot-identifier":["LOT-0000"]};
const FR_168350 = {"publication-number":"168350-2026","main-classification-lot":["30213100"],"winner-selection-status":["clos-nw"],"framework-agreement-lot":["fa-wo-rc"],"total-value-cur":["EUR"],"publication-date":"2026-03-11+01:00","result-lot-identifier":["LOT-0000"],"identifier-lot":["LOT-0000"],"total-value":75000000};
const FR_201553 = {"publication-number":"201553-2026","main-classification-lot":["30236000","30236000","30236000"],"winner-selection-status":["selec-w","selec-w","clos-nw"],"framework-agreement-lot":["fa-wo-rc","fa-wo-rc","fa-wo-rc"],"total-value-cur":["EUR"],"publication-date":"2026-03-24+01:00","result-lot-identifier":["LOT-0001","LOT-0002","LOT-0003"],"identifier-lot":["LOT-0001","LOT-0002","LOT-0003"],"total-value":474750,"tender-lot-identifier":["LOT-0001","LOT-0002"]};
const FR_287033 = {"publication-number":"287033-2025","main-classification-lot":["30213100"],"quantity-unit-lot":["H87"],"framework-agreement-lot":["none"],"total-value-cur":["EUR"],"result-lot-identifier":["LOT-0001"],"total-value":123000,"tender-value-cur":["EUR"],"tender-value":["123000"],"winner-selection-status":["selec-w"],"publication-date":"2025-05-05+02:00","identifier-lot":["LOT-0001"],"tender-lot-identifier":["LOT-0001"],"quantity-lot":["200"]};
const FR_296077 = {"publication-number":"296077-2026","main-classification-lot":["30213100","18143000"],"quantity-unit-lot":["H87","H87"],"framework-agreement-lot":["none","none"],"total-value-cur":["EUR"],"result-lot-identifier":["LOT-0001","LOT-0002"],"total-value":122880,"tender-value-cur":["EUR"],"tender-value":["119203","2880"],"winner-selection-status":["selec-w","selec-w"],"publication-date":"2026-04-30+02:00","identifier-lot":["LOT-0001","LOT-0002"],"tender-lot-identifier":["LOT-0001","LOT-0002"],"quantity-lot":["200","200"]};
const FR_380914 = {"publication-number":"380914-2026","main-classification-lot":["30200000","30200000","30200000","30200000"],"framework-agreement-lot":["fa-w-rc","fa-w-rc","fa-w-rc","fa-w-rc"],"total-value-cur":["EUR"],"result-lot-identifier":["LOT-0001","LOT-0002","LOT-0003","LOT-0004"],"total-value":1050000,"tender-value-cur":["EUR"],"tender-value":["333333.33","333333.33","333333.33","166666.67","166666.67","166666.67","350000","350000","350000","200000","200000","200000"],"winner-selection-status":["selec-w","selec-w","selec-w","selec-w"],"publication-date":"2026-06-03+02:00","identifier-lot":["LOT-0001","LOT-0002","LOT-0003","LOT-0004"],"tender-lot-identifier":["LOT-0001","LOT-0001","LOT-0001","LOT-0002","LOT-0002","LOT-0002","LOT-0003","LOT-0003","LOT-0003","LOT-0004","LOT-0004","LOT-0004"]};
const DE_619820 = {"publication-number":"619820-2026","main-classification-lot":["55321000","55321000"],"framework-agreement-lot":["none","none"],"total-value-cur":["EUR"],"result-lot-identifier":["LOT-0001","LOT-0002"],"total-value":1164176,"tender-value-cur":["EUR"],"tender-value":["1164176.00","1164176.00"],"winner-selection-status":["selec-w","selec-w"],"publication-date":"2026-09-09+02:00","identifier-lot":["LOT-0001","LOT-0002"],"tender-lot-identifier":["LOT-0002","LOT-0001"]};
const DE_688358 = {"publication-number":"688358-2026","main-classification-lot":["55524000","55524000","55524000","55524000","55524000","55524000","55524000","55524000"],"winner-selection-status":["selec-w","selec-w","selec-w","selec-w","selec-w","selec-w","clos-nw","selec-w"],"framework-agreement-lot":["none","none","none","none","none","none","none","none"],"total-value-cur":["EUR"],"publication-date":"2026-10-06+02:00","result-lot-identifier":["LOT-0001","LOT-0002","LOT-0003","LOT-0004","LOT-0005","LOT-0006","LOT-0007","LOT-0008"],"identifier-lot":["LOT-0001","LOT-0002","LOT-0003","LOT-0004","LOT-0005","LOT-0006","LOT-0007","LOT-0008"],"tender-lot-identifier":["LOT-0006","LOT-0004","LOT-0008","LOT-0002","LOT-0003","LOT-0005","LOT-0001"],"tender-value-cur":["EUR"],"tender-value":["-1","-1","-1","-1","-1","-1","-1"]};
const DE_695724 = {"publication-number":"695724-2026","main-classification-lot":["55521200","55521200","55521200","55521200"],"framework-agreement-lot":["none","none","none","none"],"total-value-cur":["EUR"],"result-lot-identifier":["LOT-0001","LOT-0002","LOT-0003","LOT-0004"],"total-value":1,"tender-value-cur":["EUR"],"tender-value":["1.00","1.00","1.00","1.00"],"winner-selection-status":["selec-w","selec-w","selec-w","selec-w"],"publication-date":"2026-10-08+02:00","identifier-lot":["LOT-0001","LOT-0002","LOT-0003","LOT-0004"],"tender-lot-identifier":["LOT-0001","LOT-0003","LOT-0002","LOT-0004"]};
const DE_703872 = {"publication-number":"703872-2026","main-classification-lot":["15894210","15894210","15894210","15894210","15894210","15894210","15894210","15894210","15894210","15894210","15894210"],"framework-agreement-lot":["none","none","none","none","none","none","none","none","none","none","none"],"total-value-cur":["EUR"],"result-lot-identifier":["LOT-0001","LOT-0002","LOT-0003","LOT-0004","LOT-0005","LOT-0006","LOT-0007","LOT-0008","LOT-0009","LOT-0010","LOT-0011"],"total-value":1030221.68,"tender-value-cur":["EUR"],"tender-value":["99103.40","219778.00","288900.00","216225.60","73877.08","96300.00","36037.60"],"winner-selection-status":["selec-w","clos-nw","selec-w","clos-nw","selec-w","selec-w","selec-w","clos-nw","clos-nw","selec-w","selec-w"],"publication-date":"2026-10-12+02:00","identifier-lot":["LOT-0001","LOT-0002","LOT-0003","LOT-0004","LOT-0005","LOT-0006","LOT-0007","LOT-0008","LOT-0009","LOT-0010","LOT-0011"],"tender-lot-identifier":["LOT-0001","LOT-0003","LOT-0005","LOT-0006","LOT-0007","LOT-0010","LOT-0011"]};
const DE_704203 = {"publication-number":"704203-2026","main-classification-lot":["55524000","55524000","55524000"],"framework-agreement-lot":["fa-wo-rc","fa-wo-rc","fa-wo-rc"],"total-value-cur":["EUR"],"result-lot-identifier":["LOT-0001","LOT-0002","LOT-0003"],"total-value":1369495.63,"tender-value-cur":["EUR"],"tender-value":["422103.53","458645.04","488747.06"],"winner-selection-status":["selec-w","selec-w","selec-w"],"publication-date":"2026-10-13+02:00","identifier-lot":["LOT-0001","LOT-0002","LOT-0003"],"tender-lot-identifier":["LOT-0001","LOT-0002","LOT-0003"]};
const DE_709723 = {"publication-number":"709723-2026","main-classification-lot":["55523000","55523000"],"framework-agreement-lot":["none","none"],"total-value-cur":["EUR"],"result-lot-identifier":["LOT-0001","LOT-0002"],"total-value":2131732,"tender-value-cur":["EUR"],"tender-value":["959176.00","1172556.00"],"winner-selection-status":["selec-w","selec-w"],"publication-date":"2026-10-14+02:00","identifier-lot":["LOT-0001","LOT-0002"],"tender-lot-identifier":["LOT-0001","LOT-0002"]};
// Poland: PLN, and the result-lot order differs from the lot order (the status of LOT-0002 comes last).
const PL_709734 = {"publication-number":"709734-2026","main-classification-lot":["30213100","30200000","30200000","30200000","30200000","30200000","30200000"],"framework-agreement-lot":["none","none","none","none","none","none","none"],"total-value-cur":["PLN"],"result-lot-identifier":["LOT-0001","LOT-0003","LOT-0004","LOT-0005","LOT-0006","LOT-0007","LOT-0002"],"total-value":56135,"tender-value-cur":["PLN"],"tender-value":["5700","21885","5280","7400","7470","8400"],"winner-selection-status":["selec-w","selec-w","selec-w","selec-w","selec-w","selec-w","clos-nw"],"identifier-lot":["LOT-0001","LOT-0002","LOT-0003","LOT-0004","LOT-0005","LOT-0006","LOT-0007"],"tender-lot-identifier":["LOT-0001","LOT-0003","LOT-0004","LOT-0005","LOT-0006","LOT-0007"]};
const PL_708749 = {"publication-number":"708749-2026","main-classification-lot":["30213100"],"framework-agreement-lot":["none"],"total-value-cur":["PLN"],"result-lot-identifier":["LOT-0001"],"total-value":4523985,"tender-value-cur":["PLN"],"tender-value":["4523985"],"winner-selection-status":["selec-w"],"identifier-lot":["LOT-0001"],"tender-lot-identifier":["LOT-0001"]};

const LAPTOPS = ["302131"];

test("TED query: country, award notices, window, CPV groups, free text, city", () => {
  assert.equal(
    buildTedQuery({ iso3: "FRA", from: "2024-10-14", stems: LAPTOPS }),
    "buyer-country = FRA AND form-type = result AND publication-date >= 20241014 AND classification-cpv = 302131* SORT BY publication-date DESC",
  );
  assert.equal(
    buildTedQuery({ iso3: "DEU", from: "2024-10-14", stems: ["55524", "555231"] }),
    "buyer-country = DEU AND form-type = result AND publication-date >= 20241014 AND (classification-cpv = 55524* OR classification-cpv = 555231*) SORT BY publication-date DESC",
  );
  assert.equal(
    buildTedQuery({ iso3: "ESP", from: "2025-01-01", text: 'señalización "vial"', city: "Madrid" }),
    'buyer-country = ESP AND form-type = result AND publication-date >= 20250101 AND FT ~ "señalización vial" AND buyer-city ~ "Madrid" SORT BY publication-date DESC',
  );
  assert.equal(cpvStem("30213100"), "302131");
});

test("TED: every country has an alpha-3 code and a name; the request asks only for fields the API accepts", () => {
  for (const [cc, c] of Object.entries(COUNTRIES)) {
    assert.match(cc, /^[A-Z]{2}$/);
    assert.match(c.iso3, /^[A-Z]{3}$/);
    assert.ok(c.name);
  }
  assert.ok(CORE_FIELDS.includes("tender-lot-identifier") && CORE_FIELDS.includes("main-classification-lot"));
  assert.equal(INFO.price_type, "contract_price");
  assert.equal(INFO.licence_url, "https://ted.europa.eu/en/legal-notice");
});

test("TED: each laptop lot counts with its winning tender's value, not the framework ceiling", () => {
  const a = parseTedNotice(FR_512887, LAPTOPS);
  assert.deepEqual(a.lots.map((l) => [l.id, l.value, l.currency, l.basis, l.framework, l.date]), [
    ["512887-2026#LOT-0001", 185249.2, "EUR", "tender", true, "2026-07-24"],
    ["512887-2026#LOT-0002", 62530, "EUR", "tender", true, "2026-07-24"],
  ]);
  const b = parseTedNotice(FR_504855, LAPTOPS);
  assert.equal(b.lots.length, 1);
  assert.equal(b.lots[0].value, 14365404); // the notice total is the 25 million ceiling
  assert.equal(b.lots[0].framework, true);
});

test("TED: a single-lot notice without a tender value falls back to the notice total", () => {
  const r = parseTedNotice(FR_434580, LAPTOPS);
  assert.equal(r.lots.length, 1);
  assert.equal(r.lots[0].value, 20830000);
  assert.equal(r.lots[0].basis, "notice_total");
});

test("TED: no winner, other products and notices without lots are counted but not used", () => {
  assert.deepEqual(parseTedNotice(FR_168350, LAPTOPS).lots, []);
  assert.equal(parseTedNotice(FR_168350, LAPTOPS).skipped.no_winner, 1);
  const o = parseTedNotice(FR_201553, LAPTOPS);
  assert.equal(o.lots.length, 0);
  assert.equal(o.skipped.other_product, 3);
  assert.equal(parseTedNotice(FR_380914, LAPTOPS).skipped.other_product, 4);
  assert.equal(parseTedNotice({ "publication-number": "1-2026" }, LAPTOPS).skipped.unknown_lots, 1);
});

test("TED: several winners of one lot with the same value are one contract; tenders are matched to lots by lot id", () => {
  const r = parseTedNotice(FR_380914, ["302"]);
  assert.deepEqual(r.lots.map((l) => l.value), [333333.33, 166666.67, 350000, 200000]);
  const reversed = parseTedNotice(DE_619820, ["55321"]);
  assert.deepEqual(reversed.lots.map((l) => [l.id, l.value]), [["619820-2026#LOT-0001", 1164176], ["619820-2026#LOT-0002", 1164176]]);
  // Several different values for one lot are ambiguous and left out (synthetic edit of a real notice: LOT-0001 gets a second, different tender).
  const ambiguous = { ...FR_504855, "tender-value": ["14365404", "9000000"], "tender-lot-identifier": ["LOT-0001", "LOT-0001"], "tender-value-cur": ["EUR", "EUR"] };
  const x = parseTedNotice(ambiguous, LAPTOPS);
  assert.equal(x.lots.length, 0);
  assert.equal(x.skipped.several_values, 1);
});

test("TED: placeholder values (1.00, -1) are not prices", () => {
  const one = parseTedNotice(DE_695724, ["5552"]);
  assert.equal(one.lots.length, 0);
  assert.equal(one.skipped.placeholder_value, 4);
  const minus = parseTedNotice(DE_688358, ["55524"]);
  assert.equal(minus.lots.length, 0);
  assert.equal(minus.skipped.placeholder_value, 7);
  assert.equal(minus.skipped.no_winner, 1);
  assert.equal(MIN_VALUE, 100);
});

test("TED: lots without a winner are skipped, the others keep their own values", () => {
  const r = parseTedNotice(DE_703872, ["15894"]);
  assert.deepEqual(
    r.lots.map((l) => [l.id.split("#")[1], l.value]),
    [["LOT-0001", 99103.4], ["LOT-0003", 219778], ["LOT-0005", 288900], ["LOT-0006", 216225.6], ["LOT-0007", 73877.08], ["LOT-0010", 96300], ["LOT-0011", 36037.6]],
  );
  assert.equal(r.skipped.no_winner, 4);
  // The seven winning values add up to the notice total (1,030,221.68), which shows each tender went to the right lot.
  assert.equal(Math.round(r.lots.reduce((a, l) => a + l.value, 0) * 100) / 100, 1030221.68);
});

test("TED: a product group is matched on each lot's own main code (children of the code count, parents do not)", () => {
  assert.equal(parseTedNotice(DE_709723, ["555231", "55524"]).skipped.other_product, 2); // 55523000 is the parent of 55523100
  assert.equal(parseTedNotice(DE_709723, ["55523"]).lots.length, 2);
  const school = parseTedNotice(DE_704203, ["555231", "55524"]);
  assert.deepEqual(school.lots.map((l) => l.value), [422103.53, 458645.04, 488747.06]);
  assert.ok(school.lots.every((l) => l.framework === true));
});

test("TED: Poland reports in PLN, and a status is matched to its lot by lot id even when the lists are in a different order", () => {
  const r = parseTedNotice(PL_709734, LAPTOPS);
  assert.equal(r.lots.length, 1);
  assert.deepEqual([r.lots[0].id, r.lots[0].value, r.lots[0].currency, r.lots[0].framework], ["709734-2026#LOT-0001", 5700, "PLN", false]);
  assert.equal(r.skipped.other_product, 6);
});

test("TED: quantity and unit are kept only for single contracts (not frameworks)", () => {
  const a = parseTedNotice(FR_287033, LAPTOPS).lots[0];
  assert.deepEqual([a.value, a.quantity, a.unit, a.framework], [123000, 200, "H87", false]);
  const b = parseTedNotice(FR_296077, LAPTOPS);
  assert.deepEqual(b.lots.map((l) => [l.value, l.quantity, l.unit]), [[119203, 200, "H87"]]);
  assert.equal(parseTedNotice(FR_504855, LAPTOPS).lots[0].quantity, undefined);
  assert.equal(unitName("H87"), "piece");
  assert.equal(unitName("MWH"), "MWh");
  assert.equal(unitName("ZZZ"), "ZZZ");
});

test("TED: free-text search uses single-lot notices only", () => {
  assert.equal(parseTedNotice(FR_504855).lots.length, 1);
  const r = parseTedNotice(FR_512887);
  assert.equal(r.lots.length, 0);
  assert.equal(r.skipped.several_lots, 2);
});

test("TED: collect adds up the reasons and drops repeats of the same lot", () => {
  const c = collect([FR_512887, FR_512887, FR_504855, FR_168350, FR_201553], LAPTOPS);
  assert.equal(c.lots.length, 3);
  assert.equal(c.skipped.no_winner, 1);
  assert.equal(c.skipped.other_product, 3);
});

test("TED: the currency with most contracts wins, EUR on a tie; the others are counted (synthetic lists)", () => {
  assert.deepEqual(pickCurrency([{ currency: "PLN" }, { currency: "PLN" }, { currency: "EUR" }]), { currency: "PLN", others: { EUR: 1 } });
  assert.equal(pickCurrency([{ currency: "PLN" }, { currency: "EUR" }]).currency, "EUR");
  assert.equal(pickCurrency([]).currency, "EUR");
  const polish = collect([PL_709734, PL_708749], LAPTOPS);
  assert.equal(pickCurrency(polish.lots).currency, "PLN");
});

test("TED: only rate limits and gateway errors are retried", () => {
  assert.equal(isRetryable(new SourceError("Source returned HTTP 429")), true);
  assert.equal(isRetryable(new SourceError("Source returned HTTP 502")), true);
  assert.equal(isRetryable(new SourceError("Source returned HTTP 400")), false);
  assert.equal(isRetryable(new InputError("Source returned HTTP 429")), false);
  assert.equal(isRetryable(new Error("HTTP 429")), false);
});

async function withFetch(handler: (url: string, body: any) => any, run: () => Promise<void>): Promise<void> {
  const real = globalThis.fetch;
  globalThis.fetch = (async (url: any, init: any) => {
    const out = handler(String(url), JSON.parse(init.body));
    return new Response(JSON.stringify(out.body ?? out), { status: out.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = real;
  }
}

test("TED end to end with a stubbed API: laptops in France", async () => {
  const seen: any[] = [];
  const notices = [FR_512887, FR_504855, FR_434580, FR_168350, FR_201553, FR_287033, FR_296077];
  await withFetch(
    (_url, body) => {
      seen.push(body);
      return { totalNoticeCount: notices.length, notices };
    },
    async () => {
      const a = await euTedContracts({ country: "FR", what: "ordinateurs portables", months: 24 });
      assert.equal(a.status, "ok");
      assert.equal(a.price_type, "contract_price");
      assert.equal(a.sample_size, 6); // 2 + 1 + 1 + 1 + 1 lots
      assert.equal(a.price?.currency, "EUR");
      assert.equal(a.source.id, "eu-ted");
      assert.match(a.query.country as string, /FR/);
      assert.match(a.summary, /not unit prices/);
      assert.match(a.summary, /framework agreements/);
      assert.deepEqual(a.extra?.matched_codes, ["30213100"]);
      assert.equal((a.extra?.left_out as any).no_winner, 1);
    },
  );
  assert.equal(seen.length, 1);
  assert.match(seen[0].query, /^buyer-country = FRA AND form-type = result AND publication-date >= \d{8} AND classification-cpv = 302131\* SORT BY publication-date DESC$/);
  assert.deepEqual(seen[0].fields.slice(0, 3), ["publication-number", "publication-date", "identifier-lot"]);
});

test("TED end to end with a stubbed API: fewer than five awards is insufficient_data, and a 400 on the optional fields is retried without them", async () => {
  let calls = 0;
  await withFetch(
    (_url, body) => {
      calls++;
      if (body.fields.includes("quantity-lot")) return { status: 400, body: { message: "unsupported field" } };
      return { totalNoticeCount: 2, notices: [FR_504855, FR_434580] };
    },
    async () => {
      const a = await euTedContracts({ country: "FR", what: "laptops", months: 24 });
      assert.equal(a.status, "insufficient_data");
      assert.equal(a.price, null);
    },
  );
  assert.equal(calls, 2);
});

test("TED end to end with a stubbed API: a rate limit is retried, a country outside the EEA is refused", async () => {
  let calls = 0;
  await withFetch(
    () => {
      calls++;
      return calls === 1 ? { status: 429, body: { message: "slow down" } } : { totalNoticeCount: 1, notices: [FR_504855] };
    },
    async () => {
      const a = await euTedContracts({ country: "DK", what: "laptops", months: 12 });
      assert.equal(a.status, "insufficient_data");
    },
  );
  assert.equal(calls, 2);
  await assert.rejects(() => euTedContracts({ country: "US", what: "laptops", months: 12 }), InputError);
  await assert.rejects(() => euTedContracts({ country: "FR", what: "laptops", cpv: "abc", months: 12 }), InputError);
});
