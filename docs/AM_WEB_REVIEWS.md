# Account Manager — Web Project Review How-To

Practical, click-by-click for AMs working a web project through the two partner-facing review touchpoints and the two staff-facing feedback surfaces.

Every button name below matches the app exactly. If a button you see reads differently, tell the tools team, that means the app drifted from this doc.

---

## The four surfaces you will use

| Surface | Where | What you do here |
| --- | --- | --- |
| **Intake & Crawl** tab | `/web/manager/<project>?tab=intake` | Kick off the site crawl. Send the partner their Content Collection link. |
| **Content Engine** tab (Step 6) | `/web/manager/<project>?tab=cowork` | Create the Sitemap & Navigation review. Send it to the partner. Resolve the notes they leave. |
| **Review** tab | `/web/manager/<project>?tab=review` | Send the partner a Website Content Review link. Apply, amend, or dismiss each comment they leave on drafted pages. |
| **Partner Hub** (partner's URL) | `/portal/<token>` | The single page the partner uses to reach everything above. You never open this yourself unless you're QA'ing the partner experience. |

---

## 1. Start a content crawl and share the Content Collection link

The partner's Content Collection is what feeds the sitemap and the copy. It is anchored to a crawl of their current site, so you always crawl first, then invite the partner to review the inventory the crawl produced.

### Step 1a. Crawl the site

1. Open the project → **Intake & Crawl** tab.
2. Scroll to the Manual scrape / crawl section.
3. Confirm the **Target URL** at the top. The default is pulled from the church record, override it only if the church has moved domains.
4. Click **Crawl now**.
   - If a previous crawl failed, the button reads **Retry crawl** instead.
   - The crawl runs async through Firecrawl. You'll see a "Crawl runs (N)" section populate below when it lands.

If a crawl already exists and you just need more pages:
- **Crawl more pages** — appends to the existing crawl, skips URLs it already has and post-style repeat slugs.
- **Re-crawl from scratch** — wipes the inventory and starts fresh. Use this only when the site changed significantly.

### Step 1b. Send the Content Collection link

Below the crawl inventory, look for the pill that says **Request from partner** (or **Update due date / regenerate** if you've already sent one).

1. Click **Request from partner**.
2. In the "Request Content Collection" modal, set the **Due date** (the target submission the partner will see).
3. Click **Generate link**.
4. The modal shows the shareable URL, click **Copy**.
5. Send the URL to the partner in ClickUp Chat with a note like:

   > Here's your Content Collection link. This is where you tell us which pages to carry over, which to merge, and answer a few setup questions. Please review the auto-populated inventory, correct anything wrong, add anything missing, and swap in any live links you find. Target date: `<date>`.

The link opens at `/portal/<token>/hub/content-collection/<session>`. If you need the Page 2 link only, the CrawlInventory panel shows both the base URL and a `?step=2` variant.

### Step 1c. Encourage the partner to clean the inventory themselves

Tell them explicitly, this reduces the ping-pong later:

- Delete or mark "not migrating" anything they don't want in the new site.
- Add pages the crawler missed (usually landing pages behind a form, staff-only URLs, ministry microsites).
- Swap in the correct live URLs when the crawl grabbed a wrong redirect.
- Add supplemental copy or files (mission statement, service times, staff bios) in the Page 2 section.

When the partner clicks **Submit** on their end, the session flips to `submitted`. You'll see it flow into the Content Engine on your side.

---

## 2. Create and share the Sitemap & Navigation review

This is the second partner touchpoint. It happens after the Content Engine has produced the sitemap.

### Step 2a. Run the Content Engine to Step 6

1. Open the project → **Content Engine** tab.
2. The Foundation pipeline card at the top shows how many of the 6 sub-steps are complete.
3. Click **Run all sub-steps** if none have run, or **Resume pipeline** to pick up. Steps 1 through 6 chain automatically.
4. When the header reads **Sitemap ready** and Step 6 (**Plan the sitemap and navigation**) shows a green **DONE** pill, the sitemap is ready to review.

### Step 2b. Open the review composer

On the Step 6 card, click **Create sitemap review**.

- Once a review row exists, the button relabels to **View sitemap review**. Same overlay.
- The composer lets you edit page purposes, key-page tags, footer groups, service times, and the announcement banner. Any change you make is auto-saved to the review draft.

### Step 2c. Publish the review

Inside the composer:

1. Confirm the review reads well (skim the page list, the megamenu previews, and the footer).
2. Click **Publish**. Status flips from `draft` to `published`.
3. The composer shows the partner URL, `/portal/sitemap/<token>`. Copy and send it to the partner.

### Step 2d. Resolve partner notes

When the partner opens their review, they can:
- Leave scoped notes per section.
- Click **Approve as-is** (locks the review), or **Share Sitemap Review Feedback** (flips status to `partner_reviewed`).

On your side, reopen the composer via **View sitemap review**. Their notes appear in the "Partner edit requests" inbox, grouped by section.

Per note you have:
- **Mark resolved** — you've handled it. The note stays as a record but is off your queue.
- **Delete** — remove the note entirely. Use this only when the note is duplicative.

Once you're done, close the loop with the partner and either re-publish or **Approve as-is** to lock the review as canonical.

---

## 3. Copywriting review, applying partner comments on drafted pages

After copy is drafted, the partner reviews the layouts one more time.

### Step 3a. Start the partner review round

1. Open the project → **Review** tab.
2. In the header, click **Start partner review**.
3. The button flips to **Link copied** briefly, then to **Copy partner review link**.
4. Send that URL to the partner.

Their URL is `/portal/review/<token>`, they walk each page and leave comments.

### Step 3b. Work the partner feedback board

Back on the Review tab, the feedback board (kanban) shows every partner comment as a card, grouped by status column.

For each card:

| Action | What it does |
| --- | --- |
| **Apply** | Writes the partner's suggested value directly into the section field and marks the comment applied. Use when the partner gave you clean copy you can drop in as-is. |
| **Amend** | Opens a small editor pre-filled with the partner's suggested value so you can tweak before saving. Use when the intent is right but you want to soften the tone or add a footer / punctuation fix. |
| **Address in editor** | Opens the section in the full editor. Use when the comment is a request rather than a suggested rewrite ("this needs to mention childcare"). Make the edit, then come back here and mark the card resolved. |
| **Resolve** | Closes the card without touching the field. Use when you've handled the request in the editor, or when the answer is "no change needed and we've told the partner." |
| **Dismiss** (kebab) | Marks the card dismissed without changing anything. Use sparingly, dismiss reads as "we're not doing this." Prefer Resolve after a conversation. |

If the partner leaves internal-note-style feedback ("we got this, no edit needed"), use **Mark complete** instead of Apply / Amend.

---

## 4. When the partner shares extra feedback outside the app

Sometimes the partner replies in ClickUp Chat or over email instead of leaving a comment on the review portal.

1. Copy their feedback verbatim.
2. Open the **Review** tab → find the relevant page / section.
3. On the feedback board, use **Add my feedback** (per-column menu) to create a comment on their behalf, tagged as coming from you-on-their-behalf.
4. Then work the card with **Apply** / **Amend** / **Address in editor** as if the partner had left it directly.

Keeping the trail inside the review board means the next AM (or you next week) has a single source of truth for what changed and why.

---

## Quick reference, which link do I send?

| Partner asked for… | Send them | Where you resolve |
| --- | --- | --- |
| Confirm site inventory + answer setup questions | `Copy` under the Content Collection card in Intake & Crawl | Their submitted session flows back into Content Engine. |
| Approve sitemap + navigation structure | `/portal/sitemap/<token>` (published from Step 6 composer) | Content Engine → Step 6 → **View sitemap review** → resolve notes in the "Partner edit requests" inbox. |
| Review drafted page copy | `/portal/review/<token>` (from Review tab → **Start partner review**) | Review tab → feedback board → **Apply / Amend / Address in editor** per card. |
| See all their outstanding asks in one place | `/portal/<partner_token>` — the Partner Hub | N/A — this is the partner's read-only surface. |
