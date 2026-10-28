# Website

The guide to Ritmo for people, at https://ritmo.typeonce.dev: what the
library is for, how its pieces fit, games running in the page, and code
snippets whose types and errors come from the compiler. It is not an API
reference (that is the JSDoc, which ships with the packages).

Built with [Astro](https://astro.build) and MDX. Needs Node 22.23.4 or newer.

```sh
pnpm --dir website dev        # http://localhost:4321
pnpm --dir website build      # dist/, with the search index
pnpm --dir website typecheck  # the demos and components
```

## Snippets

A fence marked `ts twoslash` is compiled with
[Twoslash](https://twoslash.netlify.app) against the workspace packages'
current source, with the compiler options a Ritmo game uses (`twoslash.mjs`):

- hover any name for its type and JSDoc; `//    ^?` pins a type under a line;
- `// @errors: 2345` (at the start of a line, before the code) expects that
  error and prints it under its line. Ritmo's fix message is shown alone, not
  the whole type error around it;
- `// ---cut---` hides the setup above it.

Any fence can point at what matters (`src/shiki/transformers.mjs`). Keep the
prose to a line or two and let the snippet carry the page:

- `title="move.ts"` in the fence puts a file name above the block;
- `{2,4-6}` in the fence highlights lines, `/Game.System/` highlights a word;
- `// [!code highlight]`, `// [!code focus]`, `// [!code error]`,
  `// [!code warning]` at the end of a line mark it; `// [!code ++]` and
  `// [!code --]` show a diff (use a plain `ts` fence for a "fix" diff, since
  both versions of the line would be compiled in a `ts twoslash` one).

An error a snippet does not expect fails the build, so an API change that
breaks an example fails the `Website` workflow until the page is fixed.
Snippets compile with TypeScript 6 (Twoslash needs the JavaScript compiler
API, which TypeScript 7 does not have); Ritmo supports 5.9 and up, so the
errors are the ones a game sees.

## Games

Each game in `src/demos/` exports `mount(host)`, which starts it in an
element and returns the stop function, and is listed in `src/demos/index.ts`.
It is served alone at `/play/<id>/` and embedded in a page with
`<Game id="<id>" />`: a frame that loads when it nears the screen and starts
on a click. The frame keeps the game's keyboard and gamepad listeners, and
any crash, out of the page and away from other games on it.

The top-down demo is the headless simulation in `integration/top-down`, with
a browser host and a Pixi renderer added here.

## Tools

Free tools from Ritmo live under `/tools/`, each a page that owns the whole
window (no guide layout) and mounts the tool's own package:
`/tools/pixel/` is the pixel fixer (`packages/tools`, see its README).

## Brand

Logos and icons are imported from `brand/assets` (`src/brand.ts`), never
copied. The palette is the CSS tokens in `src/styles/global.css` and the
Shiki theme in `src/shiki/ritmo.json`; see `brand/README.md` for the rules.

## Deploying

Cloudflare static assets (`wrangler.jsonc`), on the custom domain
`ritmo.typeonce.dev`. The release workflow deploys after each npm publish, so
the site documents what is on npm. To deploy by hand, run the `Website`
workflow on `main` with "Deploy" ticked, or locally:

```sh
pnpm --dir website build
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... pnpm --dir website run deploy:cloudflare
```

The token needs the Workers Scripts edit permission on the account and
Workers Routes edit on the `typeonce.dev` zone. Both values are repository
secrets (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`), also visible to
the `npm` environment the release job runs in.
