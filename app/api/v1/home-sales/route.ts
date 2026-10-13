import { homeSales } from "../../../../lib/tools";
import { json, errorResponse, baseUrl } from "../../../../lib/route-helpers";

export const maxDuration = 60;

// GET /api/v1/home-sales?country=GB&town=Bristol&property_type=terraced&months=12
// GET /api/v1/home-sales?country=FR&postcode=69003&property_type=apartment
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  try {
    const months = q.get("months") ? Number(q.get("months")) : undefined;
    const answer = await homeSales({
      country: q.get("country") ?? "",
      town: q.get("town") ?? undefined,
      postcode: q.get("postcode") ?? undefined,
      postcode_district: q.get("postcode_district") ?? undefined,
      property_type: q.get("property_type") ?? undefined,
      flat_type: q.get("flat_type") ?? undefined,
      months,
      baseUrl: baseUrl(req),
    });
    return json(answer);
  } catch (e) {
    return errorResponse(e);
  }
}
