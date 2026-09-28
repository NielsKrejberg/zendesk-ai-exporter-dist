# Zendesk AI userscript distribution

Public distribution repository for the BOLIA Zendesk AI Tampermonkey userscripts.

## Files

- `zendesk-ai-assistant.user.js` — current Zendesk AI Assistant distribution build.
- `zendesk-ai-assistant.meta.js` — Tampermonkey update metadata.
- `zendesk-ai-exporter.user.js` — legacy standalone exporter distribution build.

## Source of truth

Development, backend code, database migrations and full documentation live in the private source repository:

`NielsKrejberg/zendesk-ai-exporter`

This repository should contain distribution artifacts only. Do not add Supabase service keys, OpenAI keys, Zendesk credentials, passwords, access tokens, production ticket exports or other secrets.

## Updates

Tampermonkey uses the raw files in this repository for installation/update checks. Changes to source functionality should be made in the private source repository first and then published here.
