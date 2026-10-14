"""Acquire licensed Commons candidates into a new review directory, never directly into DB."""
import argparse
from datetime import date
import hashlib
from html import unescape
import json
from pathlib import Path
import re
import time
from urllib.error import HTTPError
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen


def plain(value):
    return unescape(re.sub(r"<[^>]+>", "", value)).strip()


def candidate(model, page):
    title = page.get("title", "")
    if not all(word.casefold() in title.casefold() for word in model.split()):
        raise ValueError("Image title must explicitly identify the requested model")
    info = page["imageinfo"][0]
    metadata = info["extmetadata"]
    license_url = metadata.get("LicenseUrl", {}).get("value", "").replace("http://", "https://")
    if not re.fullmatch(r"https://creativecommons.org/(licenses/by(?:-sa)?/[234]\.0|publicdomain/zero/1\.0)/?", license_url):
        raise ValueError("No supported explicit reusable license")
    author = plain(metadata.get("Artist", {}).get("value", ""))
    if not author or not info.get("thumburl") or urlsplit(info["thumburl"]).hostname not in ("upload.wikimedia.org", "thumb.wikimedia.org"):
        raise ValueError("Missing author or controlled thumbnail source")
    source = info["descriptionurl"]
    if urlsplit(source).hostname != "commons.wikimedia.org":
        raise ValueError("Invalid source page")
    credit = f"{author} · {plain(metadata['LicenseShortName']['value'])} · {source} · {license_url}"
    if len(credit) > 1000:
        raise ValueError("Credit exceeds API length")
    return {"model": model, "title": title, "author": author, "sourceUrl": source,
            "originalUrl": info["url"], "thumbnailUrl": info["thumburl"], "licenseUrl": license_url,
            "license": plain(metadata["LicenseShortName"]["value"]), "attribution": credit,
            "description": plain(metadata.get("ImageDescription", {}).get("value", "")),
            "verifiedDate": date.today().isoformat(),
            "changes": "Wikimedia thumbnail, unedited. Illustrative model/market variant, not the actual rental unit."}


def fetch(url):
    with urlopen(Request(url, headers={"User-Agent": "KDriveThesis/1.0 (licensed vehicle asset review)"}), timeout=45) as response:
        return response.read()


def prepare(models, out, resume=False):
    if out.exists() and not resume:
        raise ValueError("New review directory required; never overwrite evidence")
    out.mkdir(parents=True, exist_ok=resume)
    selected = json.loads((out / "selection.json").read_text(encoding="utf-8")) if resume else []
    for item in selected:
        if hashlib.sha256((out / item["file"]).read_bytes()).hexdigest() != item["sha256"]:
            raise ValueError("Resume asset drift")
    for model in models:
        if any(item["model"] == model for item in selected):
            continue
        slug = re.sub(r"[^a-z0-9]+", "-", model.lower()).strip("-")
        params = {"action": "query", "format": "json", "generator": "search", "gsrnamespace": 6,
                  "gsrsearch": '"' + model + '" filetype:bitmap' + (' -hatchback' if model == 'Honda City' else '') + (' N18' if model == 'Nissan Almera' else '') + (' -screen -interior -dashboard' if model == 'VinFast VF 6' else ''), "gsrlimit": 12,
                  "prop": "imageinfo", "iiprop": "url|extmetadata|size", "iiurlwidth": 1200}
        raw = fetch("https://commons.wikimedia.org/w/api.php?" + urlencode(params))
        (out / (slug + ".metadata.json")).write_bytes(raw)
        pages = list(json.loads(raw).get("query", {}).get("pages", {}).values())
        pages.sort(key=lambda p: (bool(re.search(r"rear|interior|engine|logo|wheel|dashboard|badge|concept|screen|detail", p.get("title", ""), re.I)),
                                  not bool(re.search(r"front", p.get("title", ""), re.I)), p.get("index", 999)))
        for page in pages:
            try:
                item = candidate(model, page)
                break
            except (ValueError, KeyError):
                continue
        else:
            raise ValueError("No licensed exact-model candidate for " + model)
        filename = slug + "-catalog.jpg"
        photo = fetch(item["thumbnailUrl"])
        if not photo.startswith(b"\xff\xd8"):
            raise ValueError("Not JPEG for " + model)
        (out / filename).write_bytes(photo)
        item.update(file=filename, url="/media/vehicles/" + filename, sha256=hashlib.sha256(photo).hexdigest(), bytes=len(photo))
        selected.append(item)
        (out / "selection.json").write_text(json.dumps(selected, ensure_ascii=False, indent=2), encoding="utf-8")
        print("Candidate saved: " + model + " | " + item["title"], flush=True)
        time.sleep(3)
    return selected


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--models", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args()
    try:
        prepare(json.loads(args.models.read_text(encoding="utf-8")), args.output, args.resume)
    except HTTPError as error:
        raise SystemExit(f"HTTP {error.code}; candidates retained. Respect Retry-After before explicit resume.") from None
