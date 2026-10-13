import { coverage } from "../../../../lib/tools";
import { json } from "../../../../lib/route-helpers";

export async function GET() {
  return json(coverage());
}
