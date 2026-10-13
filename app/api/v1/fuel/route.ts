import { fuelNow } from "../../../../lib/tools";
import { json, errorResponse, baseUrl } from "../../../../lib/route-helpers";

export const maxDuration = 60;

// GET /api/v1/fuel?country=FR&postcode=75015&fuel=diesel
// GET /api/v1/fuel?country=ES&postcode=28001&fuel=petrol95
// GET /api/v1/fuel?country=IT&area=MI&fuel=diesel&service=self
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  try {
    const answer = await fuelNow({
      country: q.get("country") ?? "",
      postcode: q.get("postcode") ?? undefined,
      department: q.get("department") ?? undefined,
      area: q.get("area") ?? undefined,
      town: q.get("town") ?? undefined,
      fuel: q.get("fuel") ?? "",
      service: q.get("service") ?? undefined,
      baseUrl: baseUrl(req),
    });
    return json(answer);
  } catch (e) {
    return errorResponse(e);
  }
}
