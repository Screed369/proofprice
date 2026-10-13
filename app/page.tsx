export default function Home() {
  return (
    <main>
      <h1>Price Paid plug</h1>
      <p>Real prices actually paid, from official records, in one place for AI agents. <strong>Private test (v0).</strong></p>
      <h2>For AI agents</h2>
      <p>MCP endpoint: <code>/api/mcp</code></p>
      <h2>REST API</h2>
      <ul>
        <li><code>/api/v1/home-sales?country=GB&amp;town=Bristol&amp;property_type=terraced</code></li>
        <li><code>/api/v1/home-sales?country=SG&amp;town=Tampines&amp;flat_type=4%20ROOM</code></li>
        <li><code>/api/v1/home-sales?country=FR&amp;postcode=69003&amp;property_type=apartment</code></li>
        <li><code>/api/v1/fuel?country=FR&amp;postcode=75015&amp;fuel=diesel</code></li>
        <li><code>/api/v1/fuel?country=ES&amp;postcode=28001&amp;fuel=petrol95</code></li>
        <li><code>/api/v1/fuel?country=IT&amp;area=MI&amp;fuel=diesel</code></li>
        <li><code>/api/v1/coverage</code></li>
        <li><code>POST /api/v1/receipts/verify</code>: send an order email (.eml) to check its seal</li>
      </ul>
      <p><a href="/method">How the numbers are made</a> · <a href="/llms.txt">llms.txt (menu for AIs)</a> · <a href="/openapi.json">openapi.json</a></p>
    </main>
  );
}
