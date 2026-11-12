import { test } from "node:test";
import assert from "node:assert/strict";
import { parseListing, parseTakster, fieldsFor, searchWords, findTakst, takstAnswer } from "./source";

// Real tariff blocks copied from Takster_Lege_01092026 oppdatert.xml (helsedirektoratet.no), read 12 Nov 2026 (Beskrivelse cut short).
const HEAD = `<?xml version="1.0" encoding="ISO-8859-1" standalone="yes"?>
<Taksttabell xmlns="http://helfo.no/skjema/taksttabell">
    <fagomraade>LE</fagomraade>
    <tidspunkt>2026-09-01</tidspunkt>
    <antalltakster>555</antalltakster>\n`;
const REAL = `<Takst>
        <takstkode>Hn1</takstkode>
        <fradato>2026-07-01</fradato>
        <honorar>152.0</honorar>
        <refusjon>152.0</refusjon>
        <repetisjonsprosent>100</repetisjonsprosent>
        <spesialisttakst>false</spesialisttakst>
        <minimumTidsbrukPerRep>0</minimumTidsbrukPerRep>
        <Beskrivelse>Utfylling av søknad i blåreseptløsning</Beskrivelse>
    </Takst>
<Takst>
        <takstkode>K01a</takstkode>
        <fradato>2026-07-01</fradato>
        <honorar>7489.0</honorar>
        <refusjon>7489.0</refusjon>
        <maksRepetisjoner>1</maksRepetisjoner>
        <repetisjonsprosent>100</repetisjonsprosent>
        <spesialisttakst>true</spesialisttakst>
        <maksAntallPerKalenderAar>700</maksAntallPerKalenderAar>
        <minimumTidsbrukPerRep>0</minimumTidsbrukPerRep>
        <Beskrivelse>Kataraktoperasjon, inntil 700 operasjoner per kalenderår. Antall inngrep kan etter søknad til regionalt helseforetak økes noe, dersom regionalt helseforetak fin</Beskrivelse>
    </Takst>
<Takst>
        <takstkode>S2ad</takstkode>
        <fradato>2026-07-01</fradato>
        <honorar>179.0</honorar>
        <refusjon>0.0</refusjon>
        <egenandel>179.0</egenandel>
        <maksRepetisjoner>0</maksRepetisjoner>
        <repetisjonsprosent>0</repetisjonsprosent>
        <spesialisttakst>false</spesialisttakst>
        <ugyldigKombinasjon>S1ad|S1ak|S1bd|S1f|S1i|S1k|S2ak|S2ck|S2at|S2av|S2aft|S2afv|S2sf|S2ss|S11ad|S11ak|S11bd|S11cd|S11ck|S11f|S11hd|S11id|S14|S21d|S21k|S21k2|S217c</ugyldigKombinasjon>
        <minimumTidsbruk>1</minimumTidsbruk>
        <minimumTidsbrukPerRep>0</minimumTidsbrukPerRep>
        <Beskrivelse>Konsultasjon hos allmennlege.</Beskrivelse>
    </Takst>
<Takst>
        <takstkode>S2ak</takstkode>
        <fradato>2026-07-01</fradato>
        <honorar>313.0</honorar>
        <refusjon>12.0</refusjon>
        <egenandel>301.0</egenandel>
        <maksRepetisjoner>0</maksRepetisjoner>
        <repetisjonsprosent>0</repetisjonsprosent>
        <spesialisttakst>false</spesialisttakst>
        <ugyldigKombinasjon>S1ad|S1ak|S1bd|S1f|S1i|S1k|S2ad|S2cd|S2at|S2av|S2aft|S2afv|S2sf|S2ss|S11ad|S11ak|S11bd|S11cd|S11ck|S11hd|S11id|S14|S21d|S21k|S21k2|S217c</ugyldigKombinasjon>
        <minimumTidsbruk>1</minimumTidsbruk>
        <minimumTidsbrukPerRep>0</minimumTidsbrukPerRep>
        <Beskrivelse>Konsultasjon hos allmennlege.</Beskrivelse>
    </Takst>
<Takst>
        <takstkode>2ad</takstkode>
        <fradato>2026-07-01</fradato>
        <honorar>194.0</honorar>
        <refusjon>15.0</refusjon>
        <egenandel>179.0</egenandel>
        <maksRepetisjoner>0</maksRepetisjoner>
        <repetisjonsprosent>0</repetisjonsprosent>
        <spesialisttakst>false</spesialisttakst>
        <ugyldigKombinasjon>1ad|1ak|1bd|1bk|1f|1g|1i|1k|2ak|2ck|2dk|2as|2at|2av|2aft|2afv|2aks|2akt|2akv|2sf|2ss|2ssd|3ad|3ae|3bd|3c|4a1|4b1|4c1|4c2|4da|4db|4e|11ad|11ak|11bd|11cd|11ck|11dd|11dk|11hd|11id|11nk|12ad|12bd|12cd|14|15a|15b|21d|21k|21k2|217c|621a|621b|621c|621d|622a|622b|623a|623b|623c|623d|624a|624b|L120|L30</ugyldigKombinasjon>
        <minimumTidsbruk>1</minimumTidsbruk>
        <minimumTidsbrukPerRep>0</minimumTidsbrukPerRep>
        <Beskrivelse>Konsultasjon hos allmennlege.</Beskrivelse>
    </Takst>
`;
// parseTakster needs 20+ codes (a guard against a changed file): pad with the real blocks under other codes.
let pad = "";
for (let i = 0; i < 5; i++) pad += REAL.replace(/<takstkode>(\w+)<\/takstkode>/g, (_m, c) => `<takstkode>${c}x${i}</takstkode>`);
const XML = HEAD + REAL + pad + "</Taksttabell>";

const PAGE = `<a href="https://www.helsedirektoratet.no/tilskudd-og-finansiering/finansiering/takster/Takster_Lege_01092026%20oppdatert.xml">Lege</a>
<a href="https://www.helsedirektoratet.no/tilskudd-og-finansiering/finansiering/takster/Takster_Lege_m_merknader_01092026%20oppdatert.xml">Lege m</a>
<a href="https://www.helsedirektoratet.no/tilskudd-og-finansiering/finansiering/takster/Takster_Lege_01032026.xml">old</a>
<a href="/tilskudd-og-finansiering/finansiering/takster/Takster_Psykolog_01092026.xml">Psykolog</a>
<a href="https://www.helsedirektoratet.no/tilskudd-og-finansiering/finansiering/takster/Takster_Fysioterapeut_kommunal_01072026%20oppdatert.xml">kommunal</a>`;

test("no-helfo-takster picks the newest plain file per field from the page", () => {
  const files = parseListing(PAGE);
  assert.deepEqual(files.map((f) => [f.field, f.from]), [["Lege", "2026-09-01"], ["Psykolog", "2026-09-01"]]);
  assert.ok(files[0].url.endsWith("Takster_Lege_01092026%20oppdatert.xml"));
  assert.ok(files[1].url.startsWith("https://www.helsedirektoratet.no/tilskudd"));
});
test("no-helfo-takster parses fees, refunds and the patient share, and rejects other files", () => {
  const { takster, published } = parseTakster(XML, "Lege", "2026-11-12");
  assert.equal(published, "2026-09-01");
  const s = takster.find((t) => t.code === "S2ad")!;
  assert.equal(s.fee, 179);
  assert.equal(s.refund, 0);
  assert.equal(s.patientShare, 179);
  assert.equal(takster.find((t) => t.code === "K01a")!.specialist, true);
  assert.equal(takster.find((t) => t.code === "Hn1")!.text, "Utfylling av søknad i blåreseptløsning");
  assert.throws(() => parseTakster(XML, "Lege", "2026-06-30"), /format changed/); // nothing is valid before 2026-07-01
});
test("no-helfo-takster refuses a file that is not a tariff table", () => {
  assert.throws(() => parseTakster("<html>blocked</html>", "Lege", "2026-11-12"), /format changed/);
  assert.throws(() => parseTakster(HEAD + REAL + "</Taksttabell>", "Lege", "2026-11-12"), /format changed/);
});
test("no-helfo-takster finds services by code and by English or Norwegian words", () => {
  const { takster } = parseTakster(XML, "Lege", "2026-11-12");
  assert.equal(findTakst(takster, "s2ad")!.item.fee, 179);
  assert.equal(findTakst(takster, "S9999"), null);
  assert.equal(findTakst(takster, "cataract operation")!.item.code, "K01a");
  assert.equal(findTakst(takster, "katarakt")!.item.code, "K01a");
  assert.equal(findTakst(takster, "consultation")!.item.code.startsWith("S2a") || findTakst(takster, "consultation")!.item.code.startsWith("2ad"), true);
  assert.equal(findTakst(takster, "quantum physics"), null);
  assert.deepEqual(searchWords("cataract operation"), ["katarakt", "operasjon"]);
  assert.throws(() => searchWords(" "), /Give a medical service/);
});
test("no-helfo-takster chooses the profession from the question", () => {
  assert.deepEqual(fieldsFor("psychologist session"), ["Psykolog"]);
  assert.deepEqual(fieldsFor("dentist check-up"), ["Tannlege"]);
  assert.deepEqual(fieldsFor("physiotherapy"), ["Fysioterapeut"]);
  assert.deepEqual(fieldsFor("GP consultation"), ["Lege"]);
  assert.equal(fieldsFor("cataract operation").length, 4);
});
test("no-helfo-takster answers with a labelled tariff fee, never a paid price", () => {
  const { takster } = parseTakster(XML, "Lege", "2026-11-12");
  const a = takstAnswer({ match: findTakst(takster, "S2ak"), service: "S2ak", from: "2026-09-01", published: "2026-09-01" });
  assert.equal(a.status, "ok");
  assert.equal(a.price?.currency, "NOK");
  assert.equal(a.price?.value, 313);
  assert.equal(a.price_type, "reimbursement_price");
  assert.match(a.summary, /state refunds/);
  assert.equal((a.extra as any).patient_share_nok, 301);
  assert.equal(takstAnswer({ match: null, service: "x", from: "2026-09-01", published: null }).status, "no_matches");
});
