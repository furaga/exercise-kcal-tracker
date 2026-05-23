from __future__ import annotations

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass, field
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


APP_UA = "health-food-lookup/0.1 (local research tool)"

OFF_FIELDS = ",".join(
    [
        "code",
        "product_name",
        "generic_name",
        "brands",
        "quantity",
        "serving_size",
        "countries",
        "countries_tags",
        "url",
        "image_front_small_url",
        "nutriments",
        "complete",
        "states_tags",
    ]
)

OFF_NUTRIENTS = {
    "energy_kcal": ("energy-kcal_100g", "kcal/100g"),
    "protein": ("proteins_100g", "g/100g"),
    "fat": ("fat_100g", "g/100g"),
    "carbs": ("carbohydrates_100g", "g/100g"),
    "sat_fat": ("saturated-fat_100g", "g/100g"),
    "sugars": ("sugars_100g", "g/100g"),
    "fiber": ("fiber_100g", "g/100g"),
    "salt": ("salt_100g", "g/100g"),
    "sodium": ("sodium_100g", "g/100g"),
}

USDA_NUTRIENTS = {
    1008: ("energy_kcal", "kcal/100g"),
    1003: ("protein", "g/100g"),
    1004: ("fat", "g/100g"),
    1005: ("carbs", "g/100g"),
    1258: ("sat_fat", "g/100g"),
    2000: ("sugars", "g/100g"),
    1079: ("fiber", "g/100g"),
    1093: ("sodium", "mg/100g"),
}

CORE_FIELDS = ["energy_kcal", "protein", "fat", "carbs", "sat_fat", "sugars", "fiber"]
SODIUM_OR_SALT = ["sodium", "salt"]


@dataclass
class FoodHit:
    source: str
    name: str
    brand: str = ""
    barcode: str = ""
    serving: str = ""
    quantity: str = ""
    country: str = ""
    url: str = ""
    nutrients: dict[str, tuple[float, str]] = field(default_factory=dict)
    raw: dict[str, Any] = field(default_factory=dict)

    @property
    def filled_count(self) -> int:
        count = sum(1 for key in CORE_FIELDS if key in self.nutrients)
        if any(key in self.nutrients for key in SODIUM_OR_SALT):
            count += 1
        return count


def fetch_json(url: str, params: dict[str, Any] | None = None, timeout: float = 12.0) -> dict[str, Any]:
    full_url = url
    if params:
        full_url = f"{url}?{urlencode(params)}"
    request = Request(
        full_url,
        headers={
            "User-Agent": APP_UA,
            "Accept": "application/json",
        },
    )
    retry_statuses = {429, 500, 502, 503, 504}

    for attempt in range(3):
        try:
            with urlopen(request, timeout=timeout) as response:
                body = response.read()
            return json.loads(body.decode("utf-8"))
        except HTTPError as exc:
            body = exc.read()
            try:
                return json.loads(body.decode("utf-8"))
            except json.JSONDecodeError:
                pass
            if exc.code in retry_statuses and attempt < 2:
                time.sleep(1.0 + attempt)
                continue
            detail = body.decode("utf-8", errors="replace")[:500]
            raise RuntimeError(f"HTTP {exc.code} from {url}: {detail}") from exc
        except URLError as exc:
            if attempt < 2:
                time.sleep(1.0 + attempt)
                continue
            raise RuntimeError(f"Network error for {url}: {exc.reason}") from exc

    raise RuntimeError(f"Unexpected empty response from {url}")


def number(value: Any) -> float | None:
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def normalize_off_product(product: dict[str, Any]) -> FoodHit:
    nutriments = product.get("nutriments") or {}
    nutrients: dict[str, tuple[float, str]] = {}
    for output_key, (api_key, unit) in OFF_NUTRIENTS.items():
        value = number(nutriments.get(api_key))
        if value is not None:
            nutrients[output_key] = (value, unit)

    name = product.get("product_name") or product.get("generic_name") or "(unnamed product)"
    return FoodHit(
        source="openfoodfacts",
        name=name,
        brand=product.get("brands") or "",
        barcode=product.get("code") or "",
        serving=product.get("serving_size") or "",
        quantity=product.get("quantity") or "",
        country=product.get("countries") or "",
        url=product.get("url") or "",
        nutrients=nutrients,
        raw=product,
    )


def open_food_facts_barcode(barcode: str, timeout: float) -> list[FoodHit]:
    data = fetch_json(
        f"https://world.openfoodfacts.org/api/v2/product/{barcode}.json",
        {"fields": OFF_FIELDS},
        timeout,
    )
    if data.get("status") != 1 or not data.get("product"):
        return []
    return [normalize_off_product(data["product"])]


def open_food_facts_search(query: str, limit: int, timeout: float, country: str | None = None) -> list[FoodHit]:
    params: dict[str, Any] = {
        "search_terms": query,
        "search_simple": 1,
        "action": "process",
        "json": 1,
        "page_size": limit,
        "fields": OFF_FIELDS,
    }
    if country:
        params.update(
            {
                "tagtype_0": "countries",
                "tag_contains_0": "contains",
                "tag_0": country,
            }
        )
    data = fetch_json("https://world.openfoodfacts.org/cgi/search.pl", params, timeout)
    return [normalize_off_product(item) for item in data.get("products", [])[:limit]]


def normalize_usda_food(food: dict[str, Any]) -> FoodHit:
    nutrients: dict[str, tuple[float, str]] = {}
    for item in food.get("foodNutrients", []) or []:
        mapping = USDA_NUTRIENTS.get(item.get("nutrientId"))
        if not mapping:
            continue
        output_key, default_unit = mapping
        value = number(item.get("value"))
        if value is None:
            continue
        unit = (item.get("unitName") or default_unit).lower()
        if unit == "kcal":
            unit = "kcal/100g"
        elif unit in {"g", "mg"}:
            unit = f"{unit}/100g"
        nutrients[output_key] = (value, unit)

    return FoodHit(
        source="usda_fdc",
        name=food.get("description") or "(unnamed food)",
        brand=food.get("brandOwner") or food.get("brandName") or "",
        barcode=food.get("gtinUpc") or "",
        serving=(
            f"{food.get('servingSize')} {food.get('servingSizeUnit')}"
            if food.get("servingSize") and food.get("servingSizeUnit")
            else food.get("householdServingFullText") or ""
        ),
        country=food.get("marketCountry") or "",
        url=f"https://fdc.nal.usda.gov/fdc-app.html#/food-details/{food.get('fdcId')}/nutrients"
        if food.get("fdcId")
        else "",
        nutrients=nutrients,
        raw=food,
    )


def usda_search(query: str, limit: int, timeout: float) -> list[FoodHit]:
    api_key = os.getenv("FDC_API_KEY", "DEMO_KEY")
    params = {
        "query": query,
        "pageSize": limit,
        "dataType": "Branded",
        "api_key": api_key,
    }
    data = fetch_json("https://api.nal.usda.gov/fdc/v1/foods/search", params, timeout)
    return [normalize_usda_food(item) for item in data.get("foods", [])[:limit]]


def fmt_value(hit: FoodHit, key: str) -> str:
    value_unit = hit.nutrients.get(key)
    if value_unit is None:
        return "-"
    value, unit = value_unit
    return f"{value:g} {unit}"


def one_line(text: str, width: int) -> str:
    text = " ".join(str(text).split())
    if len(text) <= width:
        return text
    return text[: width - 1] + "..."


def print_hits(hits: list[FoodHit], errors: list[str]) -> None:
    if not hits and not errors:
        print("No results.")
        return

    for index, hit in enumerate(hits, start=1):
        title = one_line(hit.name, 80)
        print(f"{index}. [{hit.source}] {title}")
        details = []
        if hit.brand:
            details.append(f"brand={one_line(hit.brand, 36)}")
        if hit.barcode:
            details.append(f"barcode={hit.barcode}")
        if hit.quantity:
            details.append(f"quantity={hit.quantity}")
        if hit.serving:
            details.append(f"serving={hit.serving}")
        if hit.country:
            details.append(f"country={one_line(hit.country, 28)}")
        details.append(f"filled={hit.filled_count}/8")
        print("   " + " | ".join(details))
        print(
            "   "
            + " | ".join(
                [
                    f"kcal={fmt_value(hit, 'energy_kcal')}",
                    f"P={fmt_value(hit, 'protein')}",
                    f"F={fmt_value(hit, 'fat')}",
                    f"C={fmt_value(hit, 'carbs')}",
                    f"salt={fmt_value(hit, 'salt')}",
                    f"Na={fmt_value(hit, 'sodium')}",
                ]
            )
        )
        print(
            "   "
            + " | ".join(
                [
                    f"sat_fat={fmt_value(hit, 'sat_fat')}",
                    f"sugars={fmt_value(hit, 'sugars')}",
                    f"fiber={fmt_value(hit, 'fiber')}",
                ]
            )
        )
        if hit.url:
            print(f"   url={hit.url}")
        print()

    for error in errors:
        print(f"Warning: {error}", file=sys.stderr)


def as_json(hits: list[FoodHit], errors: list[str]) -> None:
    payload = {
        "results": [
            {
                "source": hit.source,
                "name": hit.name,
                "brand": hit.brand,
                "barcode": hit.barcode,
                "serving": hit.serving,
                "quantity": hit.quantity,
                "country": hit.country,
                "url": hit.url,
                "filled": hit.filled_count,
                "nutrients": {
                    key: {"value": value, "unit": unit}
                    for key, (value, unit) in sorted(hit.nutrients.items())
                },
            }
            for hit in hits
        ],
        "errors": errors,
    }
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def collect_results(args: argparse.Namespace) -> tuple[list[FoodHit], list[str]]:
    sources = set(args.source)
    hits: list[FoodHit] = []
    errors: list[str] = []

    def run_source(label: str, fn: Any) -> None:
        try:
            hits.extend(fn())
        except Exception as exc:  # noqa: BLE001 - CLI should keep other sources usable.
            errors.append(f"{label}: {exc}")

    if args.command == "barcode":
        if "off" in sources:
            run_source("openfoodfacts", lambda: open_food_facts_barcode(args.barcode, args.timeout))
        if "usda" in sources:
            run_source("usda_fdc", lambda: usda_search(args.barcode, args.limit, args.timeout))
    elif args.command == "search":
        if "off" in sources:
            run_source(
                "openfoodfacts",
                lambda: open_food_facts_search(args.query, args.limit, args.timeout, args.country),
            )
        if "usda" in sources:
            run_source("usda_fdc", lambda: usda_search(args.query, args.limit, args.timeout))

    return hits, errors


def source_list(value: str) -> list[str]:
    sources = [part.strip().lower() for part in value.split(",") if part.strip()]
    valid = {"off", "usda"}
    invalid = sorted(set(sources) - valid)
    if invalid:
        raise argparse.ArgumentTypeError(f"unknown source(s): {', '.join(invalid)}")
    return sources


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Probe public food nutrition databases by barcode or product name."
    )
    parser.add_argument(
        "--source",
        type=source_list,
        default=["off", "usda"],
        help="Comma-separated sources: off,usda. Default: off,usda",
    )
    parser.add_argument("--limit", type=int, default=5, help="Maximum results per source. Default: 5")
    parser.add_argument("--timeout", type=float, default=12.0, help="HTTP timeout in seconds. Default: 12")
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON")

    subparsers = parser.add_subparsers(dest="command", required=True)

    search_parser = subparsers.add_parser("search", help="Search by product or food name")
    search_parser.add_argument("query")
    search_parser.add_argument(
        "--country",
        help="Optional Open Food Facts country filter, for example: Japan",
    )

    barcode_parser = subparsers.add_parser("barcode", help="Search by barcode/GTIN/UPC")
    barcode_parser.add_argument("barcode")

    return parser


def main(argv: list[str] | None = None) -> int:
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")
    parser = build_parser()
    args = parser.parse_args(argv)
    hits, errors = collect_results(args)
    if args.json:
        as_json(hits, errors)
    else:
        print_hits(hits, errors)
    return 0 if hits else 1


if __name__ == "__main__":
    raise SystemExit(main())
