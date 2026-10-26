# Mock Commerce + journey simulator

This is a mock Commerce backend plus a journey simulator page for the Blaze native SDK preview (S117.1). It lets the Android and iOS SDKs run the full `initiate → launch → result` flow before any BT-hosted or real Commerce service exists.

- Node 20+, zero dependencies
- All state is in memory. Restarting the server invalidates every OTT and session.
- Hosted: `https://blaze-mock.beta.breeze.in` (assumed host), tenant `demo`

## Run locally

No `pnpm install` is needed; the server has no dependencies.

```bash
cd examples/mock-commerce
pnpm start                 # http://localhost:8787, simulator at /sdk, dashboard at /sdk/dashboard
pnpm dev                   # same, and restarts automatically when server.mjs changes
pnpm start --port 9000     # or PORT=9000 pnpm start
```

Flags (pass after the script name): `--port` (default `8787`), `--host` (default `0.0.0.0`), `--tls-cert` and `--tls-key` (pass both together).

| Script               | Runs                                                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm start`         | The server                                                                                                                     |
| `pnpm dev`           | The server, restarting on `server.mjs` / `sign-config.mjs` changes. Page files under `simulator/` only need a browser refresh. |
| `pnpm start:https`   | The server with `keys/dev-cert.pem` + `keys/dev-key.pem` (see below)                                                           |
| `pnpm test`          | The `node --test` suite                                                                                                        |
| `pnpm typecheck`     | Strict type-check of `simulator/` using the repo's TypeScript. Run `pnpm install` at the repo root first.                      |
| `pnpm sign-config …` | `sign-config.mjs` (see [Signed config and keys](#signed-config-and-keys))                                                      |

### HTTPS for devices

Real devices and the Android emulator need HTTPS, because the WebView loads the simulator over TLS. Use [mkcert](https://github.com/FiloSottile/mkcert):

```bash
mkcert -install
mkcert -cert-file keys/dev-cert.pem -key-file keys/dev-key.pem localhost 127.0.0.1 10.0.2.2 <your-lan-ip>
pnpm start:https
```

- **Android emulator:** reach the host machine at `https://10.0.2.2:8787`. Install mkcert's root CA (`mkcert -CAROOT`) on the emulator, or point the app's `network_security_config` at it for debug builds.
- **iOS simulator:** it uses the Mac's keychain, so `https://localhost:8787` works after `mkcert -install`.
- **Physical devices:** use `<your-lan-ip>` and install the mkcert root CA on the device.

Do not commit `dev-cert.pem`/`dev-key.pem`.

## End-to-end check

1. Start the server.
2. Mint an OTT (in production, BT's server does this):
   ```bash
   curl -s -X POST https://localhost:8787/mock/ott -H 'Content-Type: application/json' -d '{"tenantId":"demo"}'
   ```
3. In the app: `initiate(environment = MOCK, tenant demo, contentOrigin/apiHost = mock host)`, then `launch(ott)`.
4. Shop through the screens and tap **Done**. The app should get `Completed(["MOCK-ORDER-1"])` plus one event per screen.

To check the page without a device, open `http://localhost:8787/sdk` in a desktop browser and click **Start demo journey**. The page then plays the native side itself: it mints an OTT, exchanges it, and answers `runSca`/`refreshSession`. You never handle the OTT yourself.

## Simulator page (`/sdk`)

The page is a set of website-style screens that follow the ticket's journey. They copy ostia's shop pages (shop.breeze.in):

- **Look:** Poppins, the `--breeze-*` tokens and ostia's own icons.
- **Search:** the search bar and the results grid of `ProductCard`s.
- **Product:** the product page with In Stock pill, quantity selector and **Add to Cart**.
- **Cart:** a bottom-sheet drawer, like forklift's `CartDrawer`.
- **Order summary:** totals in the style of `ucp-checkout`.

Each screen sends its `eventStream` event when the shopper reaches it:

| Screen        | Shopper does                                                           | Event                     |
| ------------- | ---------------------------------------------------------------------- | ------------------------- |
| Search        | Opens with the whole catalog. Searching by name sends the event again. | `SearchViewed`            |
| Product       | Taps a product card. Quantity 1–10.                                    | `ProductViewed`           |
| Cart (drawer) | **Add to Cart**                                                        | `CartViewed`              |
| Checkout      | **Checkout** in the drawer                                             | `CheckoutStarted`         |
| Address       | **Continue to address**                                                | `AddressSelected`         |
| Confirm       | **Deliver here**; shows the order summary                              | `OrderReviewed`           |
| Pay           | **Proceed to pay**; then **Pay ₹X** calls `invokeMethod runSca`        | `PaymentStarted`          |
| Done          | After the payment check                                                | `OrderPlaced`             |
| (end)         | **Done**                                                               | `processResult` completed |

- The ✕ in the top bar sends `processResult` cancelled (`userClosed`).
- The ‹ arrow and the phone's back button both go back one screen; the cart drawer closes back to the product. On Search, back cancels with `backPressed`. On Done, back finishes as completed, because the order is already placed.
- Totals use price × quantity. `CartViewed.itemCount` is the quantity.

**Mock tools.** Tap the dashed **Mock** pill in the header to open the test-only controls. They are not part of the real page:

- **Fail** sends `processResult` failed.
- **Expire session** revokes the session, then calls `GET /mock/api/ping`. That **401 is expected**: it proves the session is dead. Next the page asks the app for a new session (`invokeMethod refreshSession`) and pings again.
- **Bridge log** shows every message to and from the app, with tokens hidden.

## Merchant dashboard (`/sdk/dashboard`)

From the dashboard you can:

- **Add test products:** name and price (₹) are required; image URL and product URL are optional and must be `http(s)`. Each product gets an id like `TEMP-1A2B3C4D`.
- **Remove any product, including the default `Mock Runner 2`.** With an empty catalog, the Search screen says the catalog is empty.
- **Reset to default:** brings back `Mock Runner 2`.
- **Start journey in this browser:** opens `/sdk?autostart=1` and starts the demo with your products.

Products are kept in `localStorage` under `blaze-mock:products`, so they only exist in that browser. A phone or emulator WebView has its own storage and starts with the default product.

Using the products in the journey:

- The simulator reloads the catalog on every `launch`.
- The later steps show the chosen product.
- Events keep the shapes in `fixtures/events.json`. Only the product fields are replaced with the chosen product's values:
  - `productId`, `name` and `price` on `ProductViewed`
  - `resultCount` on `SearchViewed`
  - `total` / `amount` on the later events
- The `runSca` amount is the chosen product's price too.
- Amounts are sent in paise.
- The completed result is always `orderIds: ["MOCK-ORDER-1"]`.

## HTTP endpoints

Errors always look like `{ "error": { "code": "...", "message": "..." } }`.

| Method | Path                     | Request                                         | Response                                                                 |
| ------ | ------------------------ | ----------------------------------------------- | ------------------------------------------------------------------------ |
| `POST` | `/mock/ott`              | `{ tenantId?: "demo", deviceBinding?: string }` | `201 { ott, expiresIn: 180, expiresAt }`                                 |
| `POST` | `/auth/session/exchange` | `{ ott, deviceBinding? }`                       | `200 { sessionToken, tokenType: "Bearer", expiresIn: 86400, expiresAt }` |
| `POST` | `/mock/revoke`           | none                                            | `200 { revokedThrough }`. Every session issued so far is revoked.        |
| `GET`  | `/mock/api/ping`         | `Authorization: Bearer <sessionToken>`          | `200 { ok, tenantId, sessionId }`, or `401`                              |
| `GET`  | `/mock/config`           | none                                            | `application/jose`: SDK config signed as an ES256 JWS, `kid mock-1`      |
| `GET`  | `/sdk`                   | none                                            | Journey simulator page (`?autostart=1` starts the standalone demo)       |
| `GET`  | `/sdk/dashboard`         | none                                            | Merchant dashboard for test products                                     |

`/auth/session/exchange` is the **assumed** Commerce path. It is still an open question with the tech lead and the Commerce owner. If it changes, update `server.mjs` and both SDKs together.

**OTT rules**

- Single use. Any presentation of a known OTT burns it, including a failed one.
- Expires 180 s after minting.
- If minted with `deviceBinding`, it only exchanges with the same `deviceBinding`.

**Session token**

- An HS256 JWT with `iss`, `sub` (tenant), `sid`, `iat` and `exp` (24 h).
- The signing secret is random per server start.

| Error code                            | Status | When                                                         |
| ------------------------------------- | ------ | ------------------------------------------------------------ |
| `INVALID_REQUEST`                     | 400    | Body is not a JSON object, or `ott` is missing               |
| `OTT_INVALID`                         | 401    | Unknown OTT                                                  |
| `OTT_USED`                            | 401    | OTT already presented once                                   |
| `OTT_EXPIRED`                         | 401    | OTT older than 180 s                                         |
| `DEVICE_MISMATCH`                     | 401    | `deviceBinding` differs from the one the OTT was minted with |
| `SESSION_MISSING` / `SESSION_INVALID` | 401    | No bearer token, or a bad signature                          |
| `SESSION_EXPIRED`                     | 401    | Session older than 24 h                                      |
| `SESSION_REVOKED`                     | 401    | Session issued before the last `/mock/revoke`                |

### Magic OTTs

These always behave the same way and can be reused, so SDK tests can hit failure paths without minting a token first.

| OTT                     | Result                                    |
| ----------------------- | ----------------------------------------- |
| `mock-ott-expired`      | `401 OTT_EXPIRED`                         |
| `mock-ott-used`         | `401 OTT_USED`                            |
| `mock-ott-invalid`      | `401 OTT_INVALID`                         |
| `mock-ott-server-error` | `500 INTERNAL_ERROR`                      |
| `mock-ott-slow`         | Succeeds after 10 s (client timeout path) |

## Bridge contract (simulator ⇄ native SDK)

The simulator implements the WebView side exactly as ostia does (`src/lib/client/modules/sdk/helpers/bridge.ts`, `native.ts`, `core.ts`).

- **Native → page:** `window.onSDKEvent(JSON.stringify({ source: "blaze", eventName, eventData }))`. `eventData` is an object.
- **Page → native:** `Native.onEvent(str)` on Android, or `webkit.messageHandlers.Native.postMessage(str)` on iOS. `str` is `JSON.stringify({ source: "breeze", eventName, eventData })`, and `eventData` is itself a **JSON string**.

**Flow**

| Native sends                                                                    | Simulator replies                                                                                                                                                                                             |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (page load)                                                                     | `appReady`                                                                                                                                                                                                    |
| `initiate` `{ requestId, service, payload: { publisherId, ... } }`              | `callbackEvent` `initiate` `status: "success"`. If `publisherId` is missing, the reply has `error: true`.                                                                                                     |
| `process` `{ requestId, service, payload: { action: "launch", sessionToken } }` | `callbackEvent` `eventStream` `ProcessStarted`, then `renderView`, `consumeBackPress`, and the Search screen once the session checks out. With no `sessionToken`, `processResult` failed (`SESSION_MISSING`). |
| `backPress`                                                                     | Goes back one screen. On Search it ends the journey with `cancelled/backPressed`.                                                                                                                             |
| `invokeMethodResult` `{ requestId, methodName, methodResult }`                  | Resolves a pending `runSca` / `refreshSession`                                                                                                                                                                |
| `terminate`                                                                     | Resets the simulator                                                                                                                                                                                          |

At launch the simulator checks the session with `GET /mock/api/ping`. A revoked or invalid session ends the journey with `failed/SESSION_INVALID`. **The OTT never reaches the page; only the session token does.**

Every `callbackEvent` has ostia's `SDKResponse` shape. The `processResult` and `eventStream` fields come from the fixtures:

```json
{
  "requestId": "<from process>",
  "service": "in.breeze.shop",
  "payload": {
    "eventName": "processResult",
    "action": "launch",
    "status": "completed",
    "orderIds": ["MOCK-ORDER-1"],
    "methodName": null,
    "event": null,
    "error": null,
    "errorDetails": null
  }
}
```

Each `eventStream` carries `payload.event`, `payload.eventData` and `payload.timestamp` from `fixtures/events.json`. The steps that send them are listed under [Simulator page](#simulator-page-sdk).

**Results and native calls**

| Trigger                         | Effect                                                                                                                                  |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| **Done**                        | `processResult` completed, `orderIds: ["MOCK-ORDER-1"]`                                                                                 |
| Header ✕                        | `processResult` cancelled, `reason: "userClosed"`                                                                                       |
| Back during search              | `processResult` cancelled, `reason: "backPressed"`                                                                                      |
| Mock tools → **Fail**           | `processResult` failed, `errorCode: "MOCK_FAILURE"`                                                                                     |
| **Pay ₹X**                      | `invokeMethod runSca` with `fixtures/sca.json` and the cart total. Continues unless `methodResult.status === "failed"`.                 |
| Mock tools → **Expire session** | `POST /mock/revoke` → ping returns 401 → `invokeMethod refreshSession`. A `methodResult.sessionToken` from native replaces the session. |

After every `processResult` the simulator sends `hideView` + `releaseBackPress`.

## Code layout

`simulator/` follows ostia's module conventions:

- Each concern has its own module, and modules only export what other modules use.
- Types live in `types.js`, the way ostia uses `types.ts`.
- Styles live in CSS files built on the theme tokens. Icons are `.svg` files (no inline SVG). Breakpoints are 768/480, and animations respect `prefers-reduced-motion`.

```
simulator/
  index.html, app.js        /sdk page + entry (thin, like ostia's /sdk route)
  dashboard.html, .js       /sdk/dashboard
  sdk/                      bridge.js, native.js, core.js: ostia sdk/helpers equivalents
                            standalone.js (plays native in a plain browser), log.js
  journey/                  store.js (state + screens), ui.js (screen rendering), fixtures.js
  catalog/store.js          localStorage test catalog
  dom.js, utils.js          small DOM and JSON helpers
  types.js, global.d.ts     JSDoc types and bridge globals (type-check only)
  styles/                   theme.css (ostia tokens), shop.css, dashboard.css
  assets/                   icons copied from ostia src/lib/assets
```

The server only serves `.html`, `.js`, `.css` and `.svg` from `simulator/`, plus `.json` from `fixtures/`.

## Fixtures

`fixtures/` holds the `eventStream` events, `processResult` payloads, the `runSca` params and the `refreshSession` params. They are the seed for S68.1, so change payload shapes here first and keep the SDK `JourneyAdapter`s in step.

## Signed config and keys

`keys/mock-1.pem` is a **test-only** P-256 key and is committed on purpose. The SDKs must trust kid `mock-1` **only** for `BlazeEnvironment.MOCK`, never for sandbox or production.

```bash
pnpm sign-config path/to/config.json     # prints the compact ES256 JWS
pnpm sign-config --export-public         # SPKI base64 (Android) and X9.63 base64 (iOS)
```

- **Android:** `KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(Base64.decode(spki)))`
- **iOS:** `SecKeyCreateWithData(x963, [kSecAttrKeyType: kSecAttrKeyTypeECSECPrimeRandom, kSecAttrKeyClass: kSecAttrKeyClassPublic], nil)`

## Tests

```bash
pnpm test
```

The suite covers:

- OTT single use and 180 s expiry
- Magic tokens
- Revoke → ping 401
- 24 h session expiry
- The config JWS verifies with the `mock-1` public key, in both its SPKI and X9.63 forms
- Static serving: only allowed file types are served, and nothing outside `simulator/` or `fixtures/`

Type-check the simulator (strict, JSDoc) with the repo's TypeScript:

```bash
pnpm typecheck
```

Changes under `examples/**` do not trigger the npm release workflow.
