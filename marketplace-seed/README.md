# SmileyChat plugin marketplace seed

These are the files that need to live at the root of the
`LukaTheHero/smileychat-plugins` GitHub repo so the in-app plugin
marketplace can fetch and install plugins from them.

## How to publish

1. Create a new repo on GitHub: **LukaTheHero/smileychat-plugins** (public).
2. Copy the contents of this folder to the root of that repo so the
   tree looks like:

```
smileychat-plugins/
  registry.json
  plugins/
    smiley-marketplace-test/
      plugin.json
      dist/
        index.js
```

3. Commit and push to `main`.
4. Verify the registry resolves:
   <https://raw.githubusercontent.com/LukaTheHero/smileychat-plugins/main/registry.json>
5. In SmileyChat: Options > Plugins > Explore plugins. The Marketplace
   Test plugin should appear with an Install button.

## Adding a new plugin

1. Add a folder under `plugins/<your-plugin-id>/` with a `plugin.json`
   manifest and the bundled JS (and CSS if any) under `dist/`.
2. Add an entry to `registry.json` with:
   - `id` matching `plugin.json` id
   - `path` pointing at the folder
   - `files` listing every file the installer should fetch
3. Commit. The marketplace picks up the change on the next listing
   fetch (no app restart required).

## Migrating to upstream

When SmileyTatsu takes ownership, this content moves to
`SmileyTatsu/smileychat-plugins` (or wherever upstream prefers). To
point SmileyChat at the new source:

- Change the `DEFAULT_PLUGIN_MARKETPLACE_SOURCE` constant in
  `server/config/runtime-config.ts`, **or**
- Override with the `SMILEYCHAT_PLUGIN_MARKETPLACE_SOURCE` env var in
  `.env` (hot-reloads in the running server within ~2 seconds).
