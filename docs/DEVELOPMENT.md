# Development

How to run BattleScene on your own computer, test changes, and contribute. To deploy your own copy, see the [README](../README.md#run-your-own-battlescene-free).

## Requirements

Use Node.js 26 and npm. npm installs into `node_modules` and uses the project-local cache configured in `.npmrc`.

## Run locally

```sh
npm ci
npm run dev
```

Open [the local app](http://127.0.0.1:5173/). With `GOOGLE_CLIENT_ID` unset, the app runs in **demo mode**: it opens as **Alex Morgan**, the demo super admin, with a sample meetup (**Foundry Fight Night**) and three arenas. No accounts or cloud services are needed. Demo changes and new meetups persist in `.battlescene/data`. Delete `.battlescene/data/meetups/foundry.json` to reset the sample meetup.

To see the team side, open [the demo registration link](http://127.0.0.1:5173/register/foundry/demo) and select **Continue with Google** to act as the demo team (**Sam Rivera**). To return to the staff view, sign out on that page.

## Test and build

Run the tests and build. Use the preview command to serve the built app with local data.

```sh
npm test
npm run build
npm run preview
```

Run a single test by name:

```sh
node --test --test-name-pattern="double elimination" test/tournament.test.js
```

## Local Google sign-in

To try real Google sign-in locally, copy [.env.example](../.env.example) to `.env.local` and fill it in. Authorize `http://127.0.0.1:5173/api/auth/callback` as a redirect URI on your Google OAuth client. Local development still stores data on disk. Once `.env.local` sets `GOOGLE_CLIENT_ID`, run `GOOGLE_CLIENT_ID= npm run dev` to get demo mode back.

## How it's built

Plain JavaScript (ES modules), React 19 and Vite on the client, and one fetch-style API handler on the server ([server/http.js](../server/http.js)). Vercel runs it through [api/dispatch.js](../api/dispatch.js), and Vite mounts it locally. Each meetup is one JSON document in a private Vercel Blob store, or on disk locally. All meetup changes go through one reducer in [server/meetup.js](../server/meetup.js). Bracket logic lives in [server/bracket.js](../server/bracket.js) and [server/rounds.js](../server/rounds.js). The [product specification](SPEC.md) describes the expected behavior.

## Assets

- **Demo robot renders** (`public/demo-robots/`): regenerate with `node scripts/demo-robots.mjs`.
- **README banner** ([docs/assets/banner.html](assets/banner.html)): run `npm ci` first so its fonts resolve, then screenshot the page at 1280×640. For example:

  ```sh
  chrome --headless=new --hide-scrollbars --window-size=1280,640 --screenshot=docs/assets/banner.png docs/assets/banner.html
  ```

  The same image works as the GitHub social preview.
- **README screenshots** (`docs/assets/screen-*.png`) are taken from demo mode with a few battles played: the **In battle** and **All ladders** spectator layouts at 1600×900, and the registration page at 390×844 phone size.

## Contributing

Issues and pull requests are welcome. Keep changes small and focused, add or update tests in `test/` for behavior changes, and update [docs/SPEC.md](SPEC.md) and the [organizer's guide](GUIDE.md) when user-facing behavior changes. Run `npm test` and `npm run build` before opening a pull request.
