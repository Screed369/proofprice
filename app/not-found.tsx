import { notFoundMetadata } from "../lib/site/meta";

// One clear 404 with a single title tag (Next's built-in 404 added a second one) and links back to the useful pages.
export const metadata = notFoundMetadata();

export default function NotFound() {
  return (
    <main>
      <h1>Page not found</h1>
      <p>We could not find that page. These are good places to start:</p>
      <p>
        <a href="/prices">Prices</a> · <a href="/connect">Connect</a> · <a href="/sources">Sources</a> · <a href="/">Home</a>
      </p>
    </main>
  );
}
