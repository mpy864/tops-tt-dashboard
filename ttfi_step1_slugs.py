"""
TTFI Scraper — Step 1: Tournament Slug Discovery

Fetches ttfi.org/results/YYYY using Playwright (bypasses Cloudflare),
extracts all tournament slugs, filters out para/masters/veterans,
and saves to a JSON file.

Usage:
    python ttfi_step1_slugs.py --year 2025
    python ttfi_step1_slugs.py --years 2022,2023,2024,2025 --output slugs.json
"""

import argparse
import json
import re
import time
from playwright.sync_api import sync_playwright

# ── Config ────────────────────────────────────────────────────────────────────

BASE_URL = "https://www.ttfi.org/results"

# Slugs containing ANY of these are excluded
EXCLUDE_KEYWORDS = [
    # Para / disability
    "para",
    "physically",
    "wheelchair",
    "deaf",
    "blind",
    "special-needs",
    # Masters / Veterans (age-based, not competitive circuit)
    "masters",
    "veteran",
    "veterans",
    "senior-citizen",
    # Misc non-competitive
    "exhibition",
    "friendly",
    # Junk/test entries
    "test",
    "friendly",
]

# ── Helpers ───────────────────────────────────────────────────────────────────

def should_exclude(slug: str) -> tuple[bool, str]:
    """Returns (exclude, reason). Expects lowercase slug."""
    s = slug  # already lowercased by caller

    # Too short to be a real tournament
    if len(slug) < 10:
        return True, "too-short"

    for kw in EXCLUDE_KEYWORDS:
        if kw in s:
            return True, kw

    return False, ""

def extract_slug(href: str) -> tuple[str, str]:
    """Returns (raw_slug_for_url, decoded_slug_for_filtering)."""
    from urllib.parse import unquote
    match = re.search(r'/events/view/([^/?#]+)', href)
    if not match:
        return "", ""
    raw     = match.group(1)
    decoded = unquote(raw).lower()
    return raw, decoded

# ── Core fetch ────────────────────────────────────────────────────────────────

def fetch_slugs_for_year(page, year: int) -> list[dict]:
    url = f"{BASE_URL}/{year}"
    print(f"\n── {year} ──────────────────────────────────")
    print(f"  Fetching: {url}")

    page.goto(url, wait_until="domcontentloaded", timeout=30000)

    try:
        page.wait_for_selector('a[href*="/events/view/"]', timeout=10000)
    except Exception:
        print(f"  ⚠ No tournament links found for {year}")
        return []

    links = page.query_selector_all('a[href*="/events/view/"]')

    seen   = set()
    result = []

    for link in links:
        href = link.get_attribute("href") or ""
        text = (link.inner_text() or "").strip()
        raw_slug, decoded_slug = extract_slug(href)

        if not raw_slug or raw_slug in seen:
            continue
        seen.add(raw_slug)

        exclude, reason = should_exclude(decoded_slug)
        if exclude:
            print(f"  ⊘  SKIP [{reason:>12}] {raw_slug}")
            continue

        # Build events_url using raw (possibly encoded) slug
        base = "https://www.ttfi.org"
        if href.startswith("http"):
            events_url = href
        else:
            events_url = base + href

        result.append({
            "season":     f"{year}-{str(year+1)[-2:]}",  # e.g. "2022-23"
            "slug":       raw_slug,
            "name":       text,
            "events_url": events_url,
        })
        print(f"  ✓  KEEP              {raw_slug}")

    print(f"\n  → {len(result)} tournaments kept for {year}")
    return result

# ── Main ──────────────────────────────────────────────────────────────────────

def run(years: list[int], output: str):
    all_slugs = []

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-blink-features=AutomationControlled",
            ]
        )
        context = browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/123.0.0.0 Safari/537.36"
            ),
            viewport={"width": 1280, "height": 800},
        )
        page = context.new_page()

        for year in years:
            slugs = fetch_slugs_for_year(page, year)
            all_slugs.extend(slugs)
            time.sleep(2)

        browser.close()

    # Deduplicate
    seen, unique = set(), []
    for s in all_slugs:
        if s["slug"] not in seen:
            seen.add(s["slug"])
            unique.append(s)

    with open(output, "w") as f:
        json.dump(unique, f, indent=2, ensure_ascii=False)

    print(f"\n{'─'*50}")
    print(f"✓ {len(unique)} total tournaments saved to {output}")
    print("\nBreakdown by year:")
    from collections import Counter
    for year, count in sorted(Counter(s["season"] for s in unique).items()):
        print(f"  {year}: {count} tournaments")

    return unique


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--year",   type=int, help="Single year e.g. 2025")
    parser.add_argument("--years",  type=str, help="Comma-separated e.g. 2022,2023,2024,2025")
    parser.add_argument("--output", type=str, default="ttfi_slugs.json")
    args = parser.parse_args()

    if args.year:
        years = [args.year]
    elif args.years:
        years = [int(y.strip()) for y in args.years.split(",")]
    else:
        years = [2022, 2023, 2024, 2025]

    run(years, args.output)
