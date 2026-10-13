import { coverage } from "../../../../lib/registry";
import { json } from "../../../../lib/route-helpers";

export async function GET() {
  return json(coverage(), 200, 3600);
}
