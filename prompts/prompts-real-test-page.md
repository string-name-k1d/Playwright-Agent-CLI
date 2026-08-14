# Prompts: Add Custom Page (MTPC) — UAT

Test prompts for the "Add Custom Page" form at `/node/add/custom_page/mtpc` on the **UAT** site `callitso.docker-uat01.ust.hk`.
Covers page creation, sections, content blocks, and form submission.
For each case, before starting: make sure the user is at the correct URL editing target page; at the end: publish the page and screenshot to inspect changes.

## Prerequisites

- **Authenticated session** for `callitso.docker-uat01.ust.hk` in `./auth-profile` (Drupal + CAS/Microsoft login).
  Capture one with `pwcli import-session --capture --url https://callitso.docker-uat01.ust.hk/user/login` and complete the 2FA flow via noVNC (`http://localhost:6080/vnc.html`).
- **HTTP Basic Auth** is supplied automatically from `.env` (`BASIC_AUTH_USER` / `BASIC_AUTH_PASS`).
- The default `TARGET_URL` is the **site homepage** (`https://callitso.docker-uat01.ust.hk/`), which is safe to check.
  These test cases target the content form, so always pass the explicit URL when running them.

## How to run

```bash
# Generate a test plan from this prompt file (auto-explores the add-page first)
pwcli plan --prompt-file ./prompts/prompts-uat-add-custom-mtpc-page.md \
  --url https://callitso.docker-uat01.ust.hk/node/add/custom_page/mtpc

# Full loop: explore → plan → generate → test → heal
pwcli autorun --prompt-file ./prompts/prompts-uat-add-custom-mtpc-page.md \
  --url https://callitso.docker-uat01.ust.hk/node/add/custom_page/mtpc --max-iterations 3
```

---

## 1. Create Basic Page with Title [standalone]

**URL:** `https://callitso.docker-uat01.ust.hk/node/add/custom_page/mtpc`

**Prompt:** Fill in the Page Title field with "Test Standard Page" and verify the title appears in the field.

