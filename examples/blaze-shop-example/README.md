# Blaze shop journey - web example

Opens the Breeze shopping assistant (`in.breeze.shop`) on a website by framing its `/sdk` page.

`@juspay/blaze-sdk-web` only loads the checkout journey (`in.breeze.onecco`) today, so this example
talks to the page directly over `postMessage`, the same messages the native SDKs use.

## Run

```sh
pnpm install
pnpm dev
```

1. Set the frame URL: pick beta, release or local (ostia on port 5180), or type any URL.
2. Edit the payloads if needed. They are sent exactly as written and saved in localStorage.
   **Reset** restores the defaults.
3. **Initiate SDK** loads the page and sends `initiate` once it reports `app-ready`.
4. **Process SDK** sends `process`; the journey opens on `renderView` and closes on `hideView`
   (the page's close button). **Terminate SDK** removes it.

## Messages

Host to page: `{ source: "blaze", eventName, eventData }`, posted to the frame's origin.
Page to host: `{ source: "breeze", eventName, eventData }`, where `eventData` is a JSON string.

| Host sends                                | Page answers                                                                            |
| ----------------------------------------- | --------------------------------------------------------------------------------------- |
| `initiate` with `payload.publisherId`     | `callbackEvent` with `payload.status: "success"` (an error if `publisherId` is missing) |
| `process` with `payload.action: "launch"` | `callbackEvent` `eventStream` / `ProcessStarted`, then `renderView`, `consumeBackPress` |
| `terminate`                               | nothing                                                                                 |

The page also sends `app-ready` when loaded, and `hideView` + `releaseBackPress` when closed.
