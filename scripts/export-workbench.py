"""Export bounded inventory metadata from an explicitly chosen read-only DB.

This is not the runtime export command: no engine module is imported, no page is
visited, no identity/review flag is promoted, and no evidence is manufactured.
Without --output the only output is stdout. --output accepts a new report name,
not an arbitrary path, and creates reports/workbench/<name>.json exclusively.
"""
from __future__ import annotations

import argparse
import ast
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import sys
import time

sys.dont_write_bytecode = True

VERSION = "divinelist.workbench-snapshot.v1"
SOURCE_VERSION = "foretagskarta.inventory-metadata.v1"
SCHEMA_HASH = "sha256:ff1e5867410d560c1bf37453558c969a8717efefae95363ad24e625813087a62"
ADAPTER_VERSION = "divinelist.adapter-key-coverage.v1"
ADAPTER_SHA256 = "sha256:aa2f340017424fed22a1c0e8e7140c66b3f2b1d0e0624d98cda6b2c6d678ab10"
BINDINGS = {
    "factHash": "sha256:837feeb902c09495e4d97bdf3a3696bc3b5ab4f764090576dceadd0b34e0d643",
    "ruleHash": "sha256:5269f4d86f079f1c338478441111a92cfd12719a486f68908db61e1ca65922ec",
    "evaluationPolicyHash": "sha256:1aeaaa97cfe50a9ad5bcbfa10c4554be7cc5c44bb9add722cfe21cbd2c72d528",
    "contractManifestHash": "sha256:a87252f1e5f7b12cda35a271ce6147a342816ffa4e6aa4c820e34b3bbc9c0fa6",
}
MAPPED_FACT_KEYS = [
    "a11y.contrast_failure_count", "a11y.html_lang_present", "a11y.missing_alt_count",
    "a11y.unlabelled_field_count", "a11y.unnamed_control_count", "availability.http_status",
    "availability.reachable", "crawl.broken_internal_links", "crawl.home_noindex",
    "forms.any_form_present", "mobile.small_tap_target_count", "mobile.viewport_meta_present",
    "security.form_actions_https", "seo.meta_description_present", "seo.title_present",
    "transport.https_enabled", "transport.mixed_content_count",
]
MAX_COMPANIES = 10_000
MAX_OUTPUT_BYTES = 12_000_000
MAX_DB_BYTES = 100 * 1024 * 1024
MAX_SOURCE_BYTES = 1_000_000
REPORT_ROOT = Path(__file__).resolve().parents[1] / "reports" / "workbench"


class Blocked(ValueError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise Blocked(message)


def canonical(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def digest(value: object) -> str:
    return "sha256:" + hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def checked_text(value: object, maximum: int, label: str) -> str:
    require(type(value) is str and 0 < len(value.strip()) <= maximum, f"Invalid bounded {label}")
    require(not any(ord(char) < 32 or ord(char) == 127 or 0xD800 <= ord(char) <= 0xDFFF for char in value), f"Invalid characters in {label}")
    require(len(value.encode("utf-16-le")) // 2 <= maximum, f"Invalid bounded {label}")
    return value


def identifier(value: object) -> str:
    result = checked_text(value, 160, "identity")
    require(bool(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9:._-]*", result)), "Invalid stable identity")
    return result


def parsed_time(value: object) -> datetime:
    require(type(value) is str and len(value) <= 35 and bool(re.fullmatch(
        r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})", value
    )), "Invalid timezone-qualified source timestamp")
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError as error:
        raise Blocked("Invalid calendar timestamp") from error


def local_path(value: str, *, directory: bool = False) -> Path:
    require(bool(value) and not value.startswith(("\\\\", "//")), "Remote/device paths are forbidden")
    path = Path(os.path.abspath(value))
    if os.name == "nt":
        import ctypes
        get_drive_type = ctypes.windll.kernel32.GetDriveTypeW
        get_drive_type.argtypes = [ctypes.c_wchar_p]
        get_drive_type.restype = ctypes.c_uint
        require(get_drive_type(path.anchor) != 4, "Mapped network drives are forbidden")
    for part in [path, *path.parents]:
        metadata = part.lstat()
        require(not stat.S_ISLNK(metadata.st_mode) and not (
            getattr(metadata, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
        ), "Symbolic links and reparse paths are forbidden")
    require(stat.S_ISDIR(path.lstat().st_mode) if directory else stat.S_ISREG(path.lstat().st_mode), "Wrong local file type")
    return path


def bounded_bytes(path: Path, maximum: int) -> bytes:
    require(path.stat().st_size <= maximum, "Input exceeds size bound")
    with path.open("rb") as handle:
        content = handle.read(maximum + 1)
    require(len(content) <= maximum, "Input grew beyond size bound")
    return content


def database_family(path: Path) -> dict:
    result = {}
    for suffix in ("", "-wal", "-shm", "-journal"):
        member = Path(str(path) + suffix)
        if not member.exists():
            require(not member.is_symlink(), "Dangling database-family link")
            result[suffix or "main"] = None
            continue
        local_path(str(member))
        content = bounded_bytes(member, MAX_DB_BYTES)
        result[suffix or "main"] = {"bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()}
    return result


def extract_fact_keys(source: bytes) -> list[str]:
    """Read syntax only. Dynamic keys fail closed instead of inflating support."""
    tree = ast.parse(source.decode("utf-8-sig"))
    keys = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "_fact_mapping":
            require(bool(node.args) and isinstance(node.args[0], ast.Constant) and type(node.args[0].value) is str, "Dynamic adapter key is not reviewed")
            keys.add(node.args[0].value)
    return sorted(keys)


def inspect_adapter(engine_root: Path) -> dict:
    path = local_path(str(engine_root / "local_engine" / "divinelist.py"))
    source = bounded_bytes(path, MAX_SOURCE_BYTES)
    source_hash = "sha256:" + hashlib.sha256(source).hexdigest()
    require(source_hash == ADAPTER_SHA256, "Adapter source changed; review and matching release are required")
    keys = extract_fact_keys(source)
    require(keys == MAPPED_FACT_KEYS, "Adapter key mapping differs from reviewed coverage")
    return {"version": ADAPTER_VERSION, "sourceSha256": source_hash, "factKeys": keys}


def read_authorizer(action: int, first: str | None, second: str | None, database: str | None, _trigger: str | None) -> int:
    if action == sqlite3.SQLITE_READ:
        # SQLite also reports a table-level READ with an empty column and no
        # database for some index-only scans. Permit that documented read only
        # for tables used by this fixed query, never writes/ATTACH/temp tables.
        table_only_read = database is None and second == "" and first in {
            "schema_migrations", "companies", "workplaces", "websites", "workplace_sites",
            "scan_runs", "collection_run_details", "conflicts", "manual_fields",
            "contact_candidates", "contact_suppressions",
        }
        return sqlite3.SQLITE_OK if database == "main" or table_only_read else sqlite3.SQLITE_DENY
    if action in {sqlite3.SQLITE_SELECT, sqlite3.SQLITE_TRANSACTION, sqlite3.SQLITE_RECURSIVE}:
        return sqlite3.SQLITE_OK
    if action == sqlite3.SQLITE_FUNCTION:
        return sqlite3.SQLITE_OK if (second or first or "").lower() in {"julianday", "coalesce"} else sqlite3.SQLITE_DENY
    return sqlite3.SQLITE_DENY


def open_readonly(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, isolation_level=None, timeout=2)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only=ON")
    connection.execute("PRAGMA trusted_schema=OFF")
    connection.execute("PRAGMA temp_store=MEMORY")
    require(connection.execute("PRAGMA query_only").fetchone()[0] == 1, "SQLite read-only guard unavailable")
    connection.set_authorizer(read_authorizer)
    deadline = time.monotonic() + 10
    connection.set_progress_handler(lambda: int(time.monotonic() > deadline), 1000)
    return connection


INVENTORY_QUERY = """
SELECT wp.workplace_uid, wp.company_uid, wp.workplace_name,
       wp.municipality_code, wp.gothenburg_status, wp.verification_status,
       wp.needs_manual_review, c.company_name,
       web.website_uid, web.host, web.domain_status,
       ws.relationship_status, ws.confidence,
       sr.scan_run_id, sr.started_at, sr.completed_at, sr.state,
       cr.execution_status,
       EXISTS(SELECT 1 FROM conflicts conflict
              WHERE conflict.status='open' AND conflict.entity_uid IN
                    (wp.workplace_uid, wp.company_uid, web.website_uid)) AS identity_conflict,
       (EXISTS(SELECT 1 FROM manual_fields mf
               WHERE mf.workplace_uid=wp.workplace_uid AND mf.do_not_contact=1)
        OR EXISTS(SELECT 1 FROM contact_candidates cc
                  WHERE cc.workplace_uid=wp.workplace_uid AND cc.do_not_contact=1)
        OR EXISTS(SELECT 1 FROM contact_suppressions cs WHERE cs.active=1 AND
                  (cs.workplace_uid=wp.workplace_uid OR cs.company_uid=wp.company_uid
                   OR (cs.workplace_uid IS NULL AND cs.company_uid IS NULL)))) AS contact_restricted
FROM workplaces wp
JOIN companies c ON c.company_uid=wp.company_uid
LEFT JOIN workplace_sites ws ON ws.workplace_uid=wp.workplace_uid AND ws.is_primary=1
LEFT JOIN websites web ON web.website_uid=ws.website_uid
LEFT JOIN scan_runs sr ON sr.scan_run_id=(
    SELECT latest.scan_run_id FROM scan_runs latest WHERE latest.website_uid=web.website_uid
    ORDER BY julianday(latest.started_at) DESC, latest.scan_run_id DESC LIMIT 1
)
LEFT JOIN collection_run_details cr ON cr.scan_run_id=sr.scan_run_id
ORDER BY wp.workplace_uid
LIMIT ?
"""


def inventory_company(row: sqlite3.Row, captured_at: str) -> dict:
    reasons = ["analysis_batch_required"]
    if row["gothenburg_status"] != "verified" or row["municipality_code"] != "1480":
        reasons.append("gothenburg_identity_unverified")
    if row["verification_status"] != "verified_current" or row["needs_manual_review"]:
        reasons.append("workplace_identity_unverified")
    if not row["website_uid"]:
        reasons.append("site_missing")
    else:
        if row["domain_status"] not in {"verified_primary", "shared_corporate"}:
            reasons.append("domain_unverified")
        if row["relationship_status"] not in {"verified_primary", "shared_corporate"} or float(row["confidence"] or 0) < 0.70:
            reasons.append("relationship_unverified")
    if row["identity_conflict"]:
        reasons.append("identity_conflict")
    if row["contact_restricted"]:
        reasons.append("contact_restriction_present")
    scan = None
    if row["scan_run_id"] is None:
        reasons.append("collection_missing")
    else:
        require(row["state"] in {"running", "needs_manual_review", "blocked", "failed", "current", "stale"}, "Unknown scan state")
        require(row["execution_status"] in {None, "completed", "partial", "blocked", "failed"}, "Unknown collection execution status")
        started = parsed_time(row["started_at"])
        captured = parsed_time(captured_at)
        require((started - captured).total_seconds() <= 300, "Collection starts after inventory snapshot")
        if row["completed_at"] is not None:
            completed = parsed_time(row["completed_at"])
            require(completed >= started and (completed - captured).total_seconds() <= 300, "Invalid collection time interval")
        scan = {"id": identifier(row["scan_run_id"]), "startedAt": row["started_at"],
                "completedAt": row["completed_at"], "state": row["state"],
                "executionStatus": row["execution_status"]}
        if row["state"] not in {"current", "needs_manual_review"} or row["execution_status"] != "completed":
            reasons.append("collection_incomplete")
        if row["state"] == "needs_manual_review":
            reasons.append("collection_review_required")
    domain = row["host"]
    require(domain is None or type(domain) is str and len(domain) <= 253 and bool(re.fullmatch(
        r"(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}", domain
    )), "Inventory domain must be a hostname without path, contact data or credentials")
    return {"companyUid": identifier(row["company_uid"]), "workplaceUid": identifier(row["workplace_uid"]),
            "name": checked_text(row["company_name"], 250, "company name"),
            "workplaceName": checked_text(row["workplace_name"], 250, "workplace name"),
            "domain": domain, "reasonCodes": reasons, "latestScan": scan}


def export_snapshot(source_db: str, engine_root: str) -> dict:
    path = local_path(source_db)
    adapter = inspect_adapter(local_path(engine_root, directory=True))
    before = database_family(path)
    require(not before["-wal"] or before["-shm"] is not None, "WAL without an existing shared-memory file is blocked")
    connection = open_readonly(path)
    try:
        connection.execute("BEGIN")
        schema = [list(row) for row in connection.execute("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name")]
        require(digest(schema) == SCHEMA_HASH, "SQLite schema does not match reviewed inventory reader")
        migrations = [row[0] for row in connection.execute("SELECT version FROM schema_migrations ORDER BY version")]
        require(migrations == list(range(1, 10)), "Migration history is not the reviewed versions 1-9")
        captured_at = utc_now()
        rows = connection.execute(INVENTORY_QUERY, (MAX_COMPANIES + 1,)).fetchall()
        require(len(rows) <= MAX_COMPANIES, "Inventory exceeds 10000 workplaces; split requires a reviewed reader")
        companies = [inventory_company(row, captured_at) for row in rows]
        require(len({item["workplaceUid"] for item in companies}) == len(companies), "Duplicate inventory workplace")
        connection.execute("ROLLBACK")
    finally:
        connection.close()
    require(database_family(path) == before, "Source database family changed during read; snapshot rejected")
    require(inspect_adapter(local_path(engine_root, directory=True)) == adapter, "Adapter changed during snapshot")
    payload = {"version": VERSION, "generatedAt": utc_now(), "sourceCapturedAt": captured_at,
               "sourceVersion": SOURCE_VERSION, "sourceSchemaHash": SCHEMA_HASH,
               "sourceDigest": digest({"companies": companies, "sourceSchemaHash": SCHEMA_HASH, "sourceVersion": SOURCE_VERSION}),
               "bindings": dict(BINDINGS), "adapterCoverage": adapter, "companies": companies}
    payload["snapshotHash"] = digest(payload)
    require(len(canonical(payload).encode("utf-8")) <= MAX_OUTPUT_BYTES, "Inventory package exceeds output byte limit")
    return payload


def write_new_report(name: str, snapshot: dict, *, report_root: Path = REPORT_ROOT) -> Path:
    require(bool(re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,79}", name)), "Output must be a new simple report name, never a path")
    local_path(str(report_root.parent), directory=True)
    if not report_root.exists():
        report_root.mkdir()
    local_path(str(report_root), directory=True)
    target = report_root / (name + ".json")
    content = canonical(snapshot) + "\n"
    require(len(content.encode("utf-8")) <= MAX_OUTPUT_BYTES, "Output exceeds size bound")
    # Exclusive create does not overwrite an old report or follow a leaf link.
    with target.open("x", encoding="utf-8", newline="\n") as handle:
        handle.write(content)
    return target


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-db", required=True)
    parser.add_argument("--engine-root", required=True)
    parser.add_argument("--output", help="New name under reports/workbench, no path or extension")
    args = parser.parse_args()
    try:
        if args.output is not None:
            require(bool(re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,79}", args.output)), "Output must be a new simple report name, never a path")
            require(not (REPORT_ROOT / (args.output + ".json")).exists(), "Output report already exists")
        snapshot = export_snapshot(args.source_db, args.engine_root)
        if args.output:
            write_new_report(args.output, snapshot)
        sys.stdout.write(canonical(snapshot) + "\n")
        return 0
    except (Blocked, OSError, sqlite3.Error, ValueError, RecursionError) as error:
        # Do not echo arbitrary DB values, filesystem paths or source code.
        message = str(error) if isinstance(error, Blocked) else "Local read or report write failed; no runtime changes were requested"
        sys.stderr.write(json.dumps({"status": "BLOCKED", "message": message}) + "\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
