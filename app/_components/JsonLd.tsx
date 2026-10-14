import { serializeJsonLd } from "../../lib/site/jsonld";

/** Prints structured data. The data is escaped by serializeJsonLd so it cannot close the script tag. */
export function JsonLd({ data }: { data: unknown }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }} />;
}
