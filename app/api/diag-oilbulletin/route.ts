// TEMPORARY diagnostic route for the eu-oil-bulletin builder. Never merged.
import { wobAnswer, wobHarvest } from "../../../sources/eu-oil-bulletin/source";
import { desnzAnswer, desnzHarvest } from "../../../sources/gb-desnz-fuel/source";

export const maxDuration = 120;

export async function GET() {
  const out: Record<string, unknown> = {};
  try {
    const h = await wobHarvest();
    const rows = h.rows.map((r) => ({ area: r.area, item: r.item, median: r.median }));
    out.eu = {
      date: h.date,
      rows: h.rows.length,
      areas: [...new Set(h.rows.map((r) => r.area))].sort().join(" "),
      note: h.note,
      sample: h.rows.filter((r) => r.area === "IE").map((r) => `${r.item}=${r.median}`).join(" "),
      answers: ["IE diesel", "DE petrol95", "PL diesel", "PT lpg", "MT heating", "BG diesel", "SE petrol95", "HU diesel"].map((q) => {
        const [country, fuel] = q.split(" ");
        try {
          return wobAnswer({ date: h.date, rows }, { country, fuel: fuel === "heating" ? "lpg" : fuel }, new Date());
        } catch (e: any) {
          return { error: String(e?.message ?? e) };
        }
      }),
    };
  } catch (e: any) {
    out.eu = { error: String(e?.message ?? e), detail: e?.detail };
  }
  try {
    const h = await desnzHarvest();
    const rows = h.rows.map((r) => ({ area: r.area, item: r.item, median: r.median }));
    out.gb = {
      date: h.date,
      rows: h.rows.length,
      note: h.note,
      items: h.rows.map((r) => `${r.item}=${r.median}`).join(" "),
      answers: ["diesel", "petrol95"].map((fuel) => desnzAnswer({ date: h.date, rows }, { fuel, town: "Leeds" }, new Date())),
    };
  } catch (e: any) {
    out.gb = { error: String(e?.message ?? e), detail: e?.detail };
  }
  return Response.json(out);
}
