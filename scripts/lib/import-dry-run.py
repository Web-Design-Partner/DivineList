"""Run the pinned company importer on SQLite memory copies, never on runtime."""
from __future__ import annotations

import argparse
import base64
from collections import Counter
from dataclasses import asdict
from datetime import datetime, timedelta, timezone
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import sys
import time
from types import ModuleType
from urllib.parse import urlsplit

sys.dont_write_bytecode = True

VERSION = "divinelist.import-dry-run.v1"
REQUEST_VERSION = "divinelist.import-dry-run-request.v1"
SEQUENCE_VERSION = "divinelist.import-dry-run-sequence.v1"
SEQUENCE_REQUEST = "divinelist.import-dry-run-sequence-request.v1"
MAX_BYTES = 100 * 1024 * 1024
MAX_INPUT_BYTES = 256_000
TIMEOUT_SECONDS = 10
SCHEMA_HASH = "sha256:ff1e5867410d560c1bf37453558c969a8717efefae95363ad24e625813087a62"
ENGINE_HASHES = {
    "__init__.py": "461cbff361d7b2b2baf34441430329236fe43eea994c8709378790584a272ceb",
    "constants.py": "7164f301973cb2e4a6c254c1cb2ceec0fd1d1b9badb4b66ba90d1b75fb7bc748",
    "importer.py": "55ddf4d3dfc820e9ba9b8383eda2783ec13cafffb17f82eb9ce3e3a9c726e1a3",
    "normalize.py": "0f461683edd01f43d62c510c59745b07b95708bc56668a3d84318db15f5b218e",
    "util.py": "645be97d89b9d97be7cea2f43c3078098788c5b1e4a3653ccd8207b89b666772",
    "database.py": "f56861ab48e9ad23063c83579c7af3de020d7305e21bd14db0fd8353a30347ae",
}
FIELDS = {
    "source_record_id", "company_name", "workplace_name", "street_address",
    "postal_code", "municipality_code", "gothenburg_status", "verification_status",
    "needs_manual_review", "verification_note", "segment", "website", "domain_status",
    "domain_confidence", "source_url", "evidence_urls", "observed_at",
}
SEGMENTS = {
    "frisör/skönhet", "restaurang/café", "hälsa/friskvård", "hantverk/hemservice",
    "specialbutik/annan lokal konsumenttjänst",
}
IMPORT_TABLES = {
    "companies", "workplaces", "workplace_company_history", "manual_fields",
    "websites", "workplace_sites", "source_observations", "source_evidence_urls",
    "conflicts", "website_redirect_aliases", "sqlite_sequence",
}
NEW_TABLES = IMPORT_TABLES - {"conflicts", "website_redirect_aliases", "sqlite_sequence"}
GUARDRAILS = {
    "sourceReadOnly": True, "simulationDatabase": ":memory:",
    "runtimeWrites": False, "networkRequests": False, "applicationFileWrites": False,
    "sqliteOperatingSystemIoNotAttested": True,
    "queueWrites": False, "outreachAuthorized": False, "advertisingAuthorized": False,
    "publicationAuthorized": False, "humanDecisionsRecorded": False,
    "identityEligibilityChanged": False, "activeVaultWrites": False,
    "schemaMigrationsPerformed": False, "bytecodeWrites": False,
    "simulatedImportOnly": True,
}


class Blocked(ValueError):
    pass


def require(condition: bool, message: str) -> None:
    if not condition:
        raise Blocked(message)


def canonical(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def digest(value: object) -> str:
    return "sha256:" + hashlib.sha256(canonical(value).encode("utf-8")).hexdigest()


def strict_object(pairs: list[tuple[str, object]]) -> dict:
    result = {}
    for key, value in pairs:
        require(key not in result, "Duplicate JSON field")
        result[key] = value
    return result


def exact_fields(value: object, keys: set[str], label: str) -> None:
    require(type(value) is dict and set(value) == keys, f"Invalid fields: {label}")


def parse_time(value: object) -> datetime:
    require(type(value) is str and bool(re.fullmatch(
        r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})", value
    )), "Timestamp requires explicit ISO timezone")
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)
    except ValueError as error:
        raise Blocked("Invalid calendar timestamp") from error


def time_ns(value: str) -> int:
    parsed = parse_time(value)
    delta = parsed - datetime(1970, 1, 1, tzinfo=timezone.utc)
    fraction = re.search(r"\.(\d+)(?:Z|[+-])", value)
    remainder = int((fraction.group(1) if fraction else "").ljust(9, "0")[6:9])
    return (delta.days * 86400 + delta.seconds) * 1_000_000_000 + delta.microseconds * 1000 + remainder


def public_host(value: object) -> str:
    require(type(value) is str and 0 < len(value) <= 4096, "Invalid URL string")
    try:
        url = urlsplit(value)
        host = (url.hostname or "").lower()
        port = url.port
    except ValueError as error:
        raise Blocked("Invalid URL") from error
    require(url.scheme == "https" and url.username is None and url.password is None
            and port in (None, 443), "Source requires credential-free public HTTPS")
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        raise Blocked("IP source is forbidden")
    labels = host.split(".")
    require(len(host) <= 253 and len(labels) >= 2 and all(
        re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label) for label in labels
    ), "Invalid public hostname")
    require(labels[-1] not in {"localhost", "local", "internal", "example", "test", "invalid", "lan", "home", "onion"},
            "Private or reserved source hostname")
    require(not all(label.isdecimal() for label in labels), "Numeric source hostname is forbidden")
    return host.removeprefix("www.")


def validate_request(request: object) -> None:
    if type(request) is dict and request.get("version") == SEQUENCE_REQUEST:
        validate_sequence(request)
        return
    exact_fields(request, {"version", "seedSha256", "planHash", "evaluatedAt", "sourceName", "records"}, "request")
    require(request["version"] == REQUEST_VERSION, "Unknown request version")
    for field in ("seedSha256", "planHash"):
        require(type(request[field]) is str and bool(re.fullmatch(r"sha256:[a-f0-9]{64}", request[field])), "Invalid input hash")
    at = time_ns(request["evaluatedAt"])
    require(type(request["sourceName"]) is str and bool(re.fullmatch(r"divinelist-seeds:[a-z0-9][a-z0-9_-]{0,79}", request["sourceName"])), "Source name must be stable divinelist-seeds:<wave_id>")
    records = request["records"]
    require(type(records) is list and 1 <= len(records) <= 3, "Select one to three records")
    source_ids = set()
    hosts = set()
    for record in records:
        exact_fields(record, FIELDS, "record")
        for field in FIELDS - {"needs_manual_review", "domain_confidence", "evidence_urls"}:
            require(type(record[field]) is str and 0 < len(record[field].strip()) <= 4000, f"Invalid record field: {field}")
        require(record["source_record_id"] not in source_ids, "Duplicate candidate source ID")
        source_ids.add(record["source_record_id"])
        require(record["municipality_code"] == "1480", "Candidate is outside local scope")
        for field in ("gothenburg_status", "verification_status", "domain_status"):
            require(record[field] == "unresolved", "Cannot import a promoted verification flag")
        require(record["needs_manual_review"] is True, "Manual review safety flag must remain true")
        require(type(record["domain_confidence"]) in (float, int) and record["domain_confidence"] == 0, "Domain confidence must remain zero")
        require(record["segment"] in SEGMENTS, "Unknown segment")
        host = public_host(record["website"])
        require(host not in hosts, "Selected candidates share a domain; resolve workplace scope first")
        hosts.add(host)
        public_host(record["source_url"])
        require(type(record["evidence_urls"]) is list and 1 <= len(record["evidence_urls"]) <= 100, "Evidence list required")
        for url in record["evidence_urls"]:
            require(public_host(url) == host, "Seed evidence host mismatch")
        require(time_ns(record["observed_at"]) <= at, "Candidate observation is in the future")


def validate_sequence(request: dict) -> None:
    exact_fields(request, {"version", "seedSha256", "planHash", "evaluatedAt", "sourceName", "records", "packets"}, "sequence")
    packets = request["packets"]
    require(type(packets) is list and 1 <= len(packets) <= 3, "Select one to three packets")
    ids, source_ids, hosts, records = set(), set(), set(), []
    for packet in packets:
        exact_fields(packet, {"packetId", "seedSha256", "planHash", "records"}, "packet")
        packet_id = packet["packetId"]
        require(type(packet_id) is str and bool(re.fullmatch(r"[a-z0-9][a-z0-9_-]{0,79}", packet_id)) and packet_id not in ids, "Invalid or duplicate packet ID")
        ids.add(packet_id)
        validate_request({"version": REQUEST_VERSION, **{key: request[key] for key in ("sourceName", "evaluatedAt")},
                          **{key: packet[key] for key in ("seedSha256", "planHash", "records")}})
        for record in packet["records"]:
            require(record["source_record_id"] not in source_ids, "Cross-packet candidate source ID collision")
            host = public_host(record["website"])
            require(host not in hosts, "Cross-packet domain collision; resolve workplace scope first")
            source_ids.add(record["source_record_id"])
            hosts.add(host)
            records.append(record)
    require(request["records"] == records, "Sequence records do not match packet order")
    for field in ("seedSha256", "planHash"):
        require(request[field] == digest([{ "packetId": packet["packetId"], field: packet[field]} for packet in packets]), "Sequence binding mismatch: " + field)


def assert_new_rows(before: dict, after: dict, count: int) -> list[dict]:
    changes = table_diff(before, after)
    unexpected = [change["table"] for change in changes if change["table"] != "sqlite_sequence" and (
        change["table"] not in NEW_TABLES or change["updated"] or change["deleted"])]
    require(not unexpected, "First import would mutate existing data or unexpected tables: " + ", ".join(unexpected))
    for table in ("companies", "workplaces", "websites", "source_observations"):
        require(after["tables"][table]["rowCount"] - before["tables"][table]["rowCount"] == count,
                "Import did not create exactly one new identity per candidate: " + table)
    return changes


def assert_replay_changes(changes: list[dict]) -> None:
    ordinary = [change for change in changes if change["table"] != "sqlite_sequence"]
    require(all(change["created"] == 0 and change["deleted"] == 0
                and change["table"] in {"companies", "workplaces", "workplace_sites"}
                and change["changedColumns"] == ["updated_at"] for change in ordinary),
            "Replay step has changes beyond permitted timestamps/sequence allocation")


def local_path(value: str, *, directory: bool = False) -> Path:
    require(value and not value.startswith(("\\\\", "//")), "Remote/device paths are forbidden")
    path = Path(os.path.abspath(value))
    require(path.is_absolute(), "Absolute local path required")
    if os.name == "nt":
        import ctypes
        get_drive_type = ctypes.windll.kernel32.GetDriveTypeW
        get_drive_type.argtypes = [ctypes.c_wchar_p]
        get_drive_type.restype = ctypes.c_uint
        require(get_drive_type(path.anchor) != 4, "Mapped network drives are forbidden")
    for segment in [path, *path.parents]:
        metadata = segment.lstat()
        require(not stat.S_ISLNK(metadata.st_mode) and not (
            getattr(metadata, "st_file_attributes", 0) & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
        ), "Symbolic links and reparse paths are forbidden")
    metadata = path.lstat()
    require(stat.S_ISDIR(metadata.st_mode) if directory else stat.S_ISREG(metadata.st_mode), "Wrong local path type")
    return path


def file_hash(path: Path, maximum: int = MAX_BYTES) -> str:
    require(path.stat().st_size <= maximum, "File exceeds safe size bound")
    hasher = hashlib.sha256()
    total = 0
    with path.open("rb") as handle:
        while data := handle.read(1024 * 1024):
            total += len(data)
            require(total <= maximum, "File grew beyond size bound")
            hasher.update(data)
    return "sha256:" + hasher.hexdigest()


def database_family(path: Path) -> dict:
    result = {}
    for suffix in ("", "-wal", "-shm", "-journal"):
        member = Path(str(path) + suffix)
        try:
            metadata = member.lstat()
        except FileNotFoundError:
            result[suffix or "main"] = None
            continue
        local_path(str(member))
        result[suffix or "main"] = {"bytes": metadata.st_size, "sha256": file_hash(member)}
    return result


def load_importer(engine_root: Path):
    package_root = local_path(str(engine_root / "local_engine"), directory=True)
    sources = {}
    for filename, expected in ENGINE_HASHES.items():
        path = local_path(str(package_root / filename))
        require(path.stat().st_size <= 1_000_000, "Engine source file too large")
        sources[filename] = path.read_bytes()
        require(len(sources[filename]) <= 1_000_000 and hashlib.sha256(sources[filename]).hexdigest() == expected,
                f"Unreviewed engine code: {filename}")
    # Never use Python's source/pyc finder: -B alone still permits stale or
    # replaced pyc reads. Execute only the bytes whose digests were checked.
    package = ModuleType("local_engine")
    package.__path__ = []
    package.__package__ = "local_engine"
    package.__file__ = str(package_root / "__init__.py")
    sys.modules["local_engine"] = package
    for name in ("constants", "util", "normalize", "database", "importer"):
        module = ModuleType("local_engine." + name)
        module.__file__ = str(package_root / (name + ".py"))
        module.__package__ = "local_engine"
        sys.modules[module.__name__] = module
        setattr(package, name, module)
        exec(compile(sources[name + ".py"], module.__file__, "exec"), module.__dict__)
    exec(compile(sources["__init__.py"], package.__file__, "exec"), package.__dict__)
    return sys.modules["local_engine.importer"]


def quoted(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def json_value(value: object) -> object:
    if isinstance(value, bytes):
        return {"sqliteBlobBase64": base64.b64encode(value).decode("ascii")}
    return value


def snapshot(connection: sqlite3.Connection) -> dict:
    schema = [list(row) for row in connection.execute("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name")]
    require(digest(schema) == SCHEMA_HASH, "SQLite schema/triggers do not match reviewed V2.3 snapshot")
    tables = {}
    for entry in schema:
        if entry[0] != "table":
            continue
        table = entry[1]
        columns = list(connection.execute(f"PRAGMA table_info({quoted(table)})"))
        names = [column[1] for column in columns]
        pk = [column[1] for column in sorted(columns, key=lambda item: item[5]) if column[5]]
        if table == "sqlite_sequence":
            pk = ["name"]
        values = {}
        occurrences = Counter()
        for row in connection.execute(f"SELECT * FROM {quoted(table)}"):
            item = {name: json_value(row[index]) for index, name in enumerate(names)}
            if pk:
                key = canonical([item[name] for name in pk])
            else:
                row_hash = digest(item)
                occurrences[row_hash] += 1
                key = canonical([row_hash, occurrences[row_hash]])
            require(key not in values, "Duplicate snapshot row identity")
            values[key] = item
        row_hashes = {key: digest(value) for key, value in sorted(values.items())}
        tables[table] = {"values": values, "rowCount": len(values), "rowsHash": digest(row_hashes)}
    public = {table: {"rowCount": value["rowCount"], "rowsHash": value["rowsHash"]} for table, value in sorted(tables.items())}
    return {"schemaHash": SCHEMA_HASH, "logicalHash": digest({"schemaHash": SCHEMA_HASH, "tables": public}), "tables": tables, "public": public}


def table_diff(before: dict, after: dict) -> list[dict]:
    differences = []
    for table in sorted(before["tables"]):
        old = before["tables"][table]
        new = after["tables"][table]
        left, right = old["values"], new["values"]
        added = set(right) - set(left)
        removed = set(left) - set(right)
        changed = {key for key in set(left) & set(right) if left[key] != right[key]}
        changed_columns = sorted({column for key in changed for column in left[key] if left[key][column] != right[key][column]})
        if added or removed or changed:
            differences.append({
                "table": table, "beforeRows": old["rowCount"], "afterRows": new["rowCount"],
                "created": len(added), "updated": len(changed), "deleted": len(removed),
                "changedColumns": changed_columns, "beforeHash": old["rowsHash"], "afterHash": new["rowsHash"],
                "createdRowHashes": sorted(digest(right[key]) for key in added),
                "updatedRowHashes": sorted(digest(right[key]) for key in changed),
                "deletedRowHashes": sorted(digest(left[key]) for key in removed),
            })
    return differences


def authorize(action: int, first: str | None, second: str | None, _database: str | None, _trigger: str | None) -> int:
    if action in (sqlite3.SQLITE_INSERT, sqlite3.SQLITE_UPDATE, sqlite3.SQLITE_DELETE):
        return sqlite3.SQLITE_OK if first in IMPORT_TABLES else sqlite3.SQLITE_DENY
    if action == sqlite3.SQLITE_FUNCTION:
        return sqlite3.SQLITE_OK if (second or first or "").lower() in {"max", "count", "coalesce"} else sqlite3.SQLITE_DENY
    if action == sqlite3.SQLITE_PRAGMA:
        return sqlite3.SQLITE_OK if first in {"table_info", "foreign_key_check", "integrity_check"} else sqlite3.SQLITE_DENY
    if action in {sqlite3.SQLITE_READ, sqlite3.SQLITE_SELECT, sqlite3.SQLITE_TRANSACTION, sqlite3.SQLITE_SAVEPOINT, sqlite3.SQLITE_RECURSIVE}:
        return sqlite3.SQLITE_OK
    return sqlite3.SQLITE_DENY


def install_deadline(connection: sqlite3.Connection) -> None:
    deadline = time.monotonic() + TIMEOUT_SECONDS
    connection.set_progress_handler(lambda: int(time.monotonic() > deadline), 1000)


def memory_snapshot(source: sqlite3.Connection) -> sqlite3.Connection:
    memory = sqlite3.connect(":memory:", isolation_level=None)
    memory.row_factory = sqlite3.Row
    deadline = time.monotonic() + TIMEOUT_SECONDS
    page_size = source.execute("PRAGMA page_size").fetchone()[0]
    def progress(_status: int, _remaining: int, total: int) -> None:
        require(time.monotonic() <= deadline, "SQLite backup deadline exceeded")
        require(total * page_size <= MAX_BYTES, "SQLite backup page bound exceeded")
    try:
        source.execute("BEGIN")
        source.execute("SELECT count(*) FROM sqlite_master").fetchone()
        source.backup(memory, pages=128, progress=progress, sleep=0.01)
        source.execute("ROLLBACK")
        memory.execute("PRAGMA foreign_keys=ON")
        memory.execute("PRAGMA temp_store=MEMORY")
        memory.execute("PRAGMA trusted_schema=OFF")
        memory.set_authorizer(authorize)
        install_deadline(memory)
        return memory
    except BaseException:
        if source.in_transaction:
            source.execute("ROLLBACK")
        memory.close()
        raise


def check_suppressions(connection: sqlite3.Connection) -> dict:
    manual = connection.execute("SELECT count(*) FROM manual_fields WHERE do_not_contact=1").fetchone()[0]
    active = connection.execute("SELECT count(*) FROM contact_suppressions WHERE active=1").fetchone()[0]
    candidate_dnc = connection.execute("SELECT count(*) FROM contact_candidates WHERE do_not_contact=1").fetchone()[0]
    candidate_total = connection.execute("SELECT count(*) FROM contact_candidates").fetchone()[0]
    clear = manual == 0 and active == 0 and candidate_dnc == 0
    return {"scope": "global_snapshot", "activeSuppressions": active, "doNotContactRows": manual,
            "contactCandidateDoNotContactRows": candidate_dnc, "contactCandidates": candidate_total,
            "expirationPolicy": "Every active suppression blocks, including expired or uncertain dates",
            "contactHashCoverage": "No active suppression rows require personal contact matching" if clear else "Unknown when protection rows exist; personal contacts are not collected",
            "status": "clear_for_simulation_only" if clear else "blocked"}


def check_migrations(connection: sqlite3.Connection, engine_root: Path) -> dict:
    rows = connection.execute("SELECT version,name,checksum FROM schema_migrations ORDER BY version").fetchall()
    require([row["version"] for row in rows] == list(range(1, 10)), "Migration history is not exactly V2.3 versions 1-9")
    directory = local_path(str(engine_root / "migrations"), directory=True)
    for row in rows:
        require(type(row["name"]) is str and bool(re.fullmatch(r"[0-9]{3}_[a-z0-9_]+\.sql", row["name"])), "Invalid migration filename")
        path = local_path(str(directory / row["name"]))
        require(file_hash(path, 1_000_000) == row["checksum"], "Migration checksum drift")
    return {"status": "PASS", "versions": list(range(1, 10)), "performed": False}


def validate_fail_closed(connection: sqlite3.Connection, source_name: str, source_ids: list[str]) -> list[dict]:
    result = []
    for source_id in source_ids:
        rows = connection.execute(
            "SELECT wp.workplace_uid,wp.company_uid,wp.gothenburg_status,wp.verification_status,wp.needs_manual_review,"
            "ws.relationship_status,ws.confidence,w.domain_status,m.manual_decision,m.qualified_for_contact,m.do_not_contact "
            "FROM source_observations so JOIN workplaces wp ON wp.workplace_uid=so.workplace_uid "
            "JOIN workplace_sites ws ON ws.workplace_uid=wp.workplace_uid AND ws.website_uid=so.website_uid "
            "JOIN websites w ON w.website_uid=so.website_uid JOIN manual_fields m ON m.workplace_uid=wp.workplace_uid "
            "WHERE so.source_name=? AND so.source_record_id=?", (source_name, source_id)
        ).fetchall()
        require(len(rows) == 1, "Imported source record is missing or has ambiguous provenance")
        row = rows[0]
        require(row["gothenburg_status"] == "unresolved" and row["verification_status"] == "unresolved"
                and row["needs_manual_review"] == 1 and row["relationship_status"] == "unresolved"
                and row["confidence"] == 0 and row["domain_status"] == "unresolved"
                and row["manual_decision"] == "pending" and row["qualified_for_contact"] == 0,
                "Importer promoted eligibility or changed manual state")
        result.append({"sourceRecordId": source_id, "companyUid": row["company_uid"], "workplaceUid": row["workplace_uid"],
                       "verificationStatus": "unresolved", "gothenburgStatus": "unresolved", "needsManualReview": True,
                       "domainConfidence": 0, "manualDecision": "pending", "qualifiedForContact": False})
    return result


def run(request: dict, engine_root: Path, database: Path) -> dict:
    validate_request(request)
    importer = load_importer(engine_root)
    family_before = database_family(database)
    require(family_before["main"] is not None, "Source database is absent")
    require(family_before["-journal"] is None, "Source journal present; stable read-only snapshot required")
    with database.open("rb") as handle:
        header = handle.read(100)
    require(header.startswith(b"SQLite format 3\x00"), "Source is not a SQLite database")
    if header[18:20] == b"\x02\x02":
        require(family_before["-wal"] is not None and family_before["-shm"] is not None,
                "WAL database lacks existing sidecars; refuse a read that could create runtime files")
    source = sqlite3.connect(database.as_uri() + "?mode=ro", uri=True, timeout=1, isolation_level=None)
    source.row_factory = sqlite3.Row
    source.execute("PRAGMA query_only=ON")
    source.execute("PRAGMA foreign_keys=ON")
    source.execute("PRAGMA temp_store=MEMORY")
    source.execute("PRAGMA trusted_schema=OFF")
    memory = None
    fresh = None
    sequence = request["version"] == SEQUENCE_REQUEST
    packets = request["packets"] if sequence else [{"packetId": "single", "seedSha256": request["seedSha256"], "planHash": request["planHash"], "records": request["records"]}]
    output = {"version": SEQUENCE_VERSION if sequence else VERSION, "status": "BLOCKED", **{key: request[key] for key in ("sourceName", "seedSha256", "planHash", "evaluatedAt")}, "selectedSourceRecordIds": [record["source_record_id"] for record in request["records"]], "source": {"path": str(database), "familyBefore": family_before}, "guardrails": dict(GUARDRAILS)}
    if sequence:
        output["sequence"] = {"sameMemoryDatabase": True, "packetOrder": [packet["packetId"] for packet in packets], "steps": []}
    try:
        memory = memory_snapshot(source)
        before = snapshot(memory)
        output["source"] = {"path": str(database), "schemaHash": before["schemaHash"], "logicalBefore": before["logicalHash"], "tables": before["public"], "familyBefore": family_before}
        output["migrationCheck"] = check_migrations(memory, engine_root)
        output["suppressionCheck"] = check_suppressions(memory)
        require(output["suppressionCheck"]["status"] == "clear_for_simulation_only",
                "Active suppression/DNC exists: global clearance cannot establish safe candidate coverage")
        original_clock = importer.utc_now
        reports = []
        states = [before]
        try:
            current = before
            for pass_index in (0, 1):
                packet_reports = []
                for packet_index, packet in enumerate(packets):
                    offset = pass_index * len(packets) + packet_index
                    simulated_at = (parse_time(request["evaluatedAt"]) + timedelta(seconds=offset)).isoformat().replace("+00:00", "Z")
                    importer.utc_now = lambda stamp=simulated_at: stamp
                    install_deadline(memory)
                    memory.execute("BEGIN IMMEDIATE")
                    try:
                        report = importer.Importer(memory).import_records(packet["records"], source_name=request["sourceName"], queue=False)
                        size = len(packet["records"])
                        require(report.read == size and report.queued == 0 and report.skipped == 0 and report.conflicts == 0,
                                "Importer skipped, queued, conflicted or failed to read a candidate")
                        require(report.imported == (size if pass_index == 0 else 0) and report.duplicates == (0 if pass_index == 0 else size),
                                "First simulation did not insert exactly the selected new records; existing sources cannot be rewritten" if pass_index == 0 else "Replay did not recognize every candidate")
                        after_packet = snapshot(memory)
                        if pass_index == 0:
                            assert_new_rows(current, after_packet, size)
                        else:
                            assert_replay_changes(table_diff(current, after_packet))
                        memory.execute("COMMIT")
                    except BaseException:
                        if memory.in_transaction:
                            memory.execute("ROLLBACK")
                        raise
                    packet_report = {**asdict(report), "simulatedAt": simulated_at}
                    packet_reports.append(packet_report)
                    if sequence:
                        output["sequence"]["steps"].append({"packetId": packet["packetId"], "pass": pass_index + 1,
                            "seedSha256": packet["seedSha256"], "planHash": packet["planHash"],
                            "selectedSourceRecordIds": [record["source_record_id"] for record in packet["records"]],
                            "beforeLogicalHash": current["logicalHash"], "afterLogicalHash": after_packet["logicalHash"],
                            "import": packet_report, "diff": table_diff(current, after_packet)})
                    current = after_packet
                combined = {key: sum(item[key] for item in packet_reports) for key in ("read", "imported", "duplicates", "conflicts", "skipped", "queued")}
                combined.update({"messages": [message for item in packet_reports for message in item["messages"]], "simulatedAt": packet_reports[0]["simulatedAt"]})
                reports.append(combined)
                states.append(current)
        finally:
            importer.utc_now = original_clock
        output["firstImport"], output["secondImport"] = reports
        first_diff, second_diff = table_diff(states[0], states[1]), table_diff(states[1], states[2])
        output["diff"] = {"first": first_diff, "second": second_diff}
        assert_new_rows(states[0], states[1], len(request["records"]))
        output["candidates"] = validate_fail_closed(memory, request["sourceName"], [record["source_record_id"] for record in request["records"]])
        ordinary_replay = [change for change in second_diff if change["table"] != "sqlite_sequence"]
        structural = all(change["created"] == 0 and change["deleted"] == 0 for change in ordinary_replay)
        timestamp_only = all(change["table"] in {"companies", "workplaces", "workplace_sites"} and change["changedColumns"] == ["updated_at"] for change in ordinary_replay)
        observations_unchanged = states[1]["tables"]["source_observations"]["rowsHash"] == states[2]["tables"]["source_observations"]["rowsHash"]
        output["idempotence"] = {"structural": structural, "sourceObservations": observations_unchanged,
            "exactRows": states[1]["logicalHash"] == states[2]["logicalHash"], "timestampOnly": timestamp_only,
            "sequenceChanges": any(change["table"] == "sqlite_sequence" for change in second_diff),
            "explanation": "Replay uses a later simulated clock; updated_at and SQLite AUTOINCREMENT allocation can change without duplicate company/source records."}
        require(structural and timestamp_only and observations_unchanged and reports[1]["imported"] == 0
                and reports[1]["duplicates"] == len(request["records"]), "Replay has changes beyond timestamps/sequence allocation")
        require(memory.execute("PRAGMA integrity_check").fetchone()[0] == "ok", "Memory integrity check failed")
        require(not memory.execute("PRAGMA foreign_key_check").fetchall(), "Memory foreign keys failed")
        output["integrity"] = {"integrityCheck": "PASS", "foreignKeys": "PASS"}
        fresh = memory_snapshot(source)
        after = snapshot(fresh)
        output["source"].update({"logicalAfter": after["logicalHash"], "unchanged": before["logicalHash"] == after["logicalHash"]})
        require(output["source"]["unchanged"], "Source runtime changed concurrently; simulation evidence is stale")
        output["status"] = "PASS"
    except (Blocked, sqlite3.Error) as error:
        output["status"] = "BLOCKED"
        output["reason"] = str(error)
    finally:
        if fresh is not None:
            fresh.close()
        if memory is not None:
            memory.close()
        source.close()
    family_after = database_family(database)
    output.setdefault("source", {}).update({"familyAfter": family_after, "familyUnchanged": family_before == family_after})
    if family_before != family_after:
        output["status"] = "BLOCKED"
        output["reason"] = "Runtime database family changed during read-only simulation; no stable no-change proof"
    output["reportHash"] = digest(output)
    return output


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--engine-root", required=True)
    parser.add_argument("--source-db", required=True)
    args = parser.parse_args()
    bindings = {}
    version = VERSION
    try:
        raw = sys.stdin.buffer.read(MAX_INPUT_BYTES + 1)
        require(len(raw) <= MAX_INPUT_BYTES, "Request exceeds safe size bound")
        request = json.loads(raw.decode("utf-8"), object_pairs_hook=strict_object,
                             parse_constant=lambda _value: (_ for _ in ()).throw(Blocked("Nonfinite JSON number")))
        if type(request) is dict and request.get("version") == SEQUENCE_REQUEST:
            version = SEQUENCE_VERSION
        validate_request(request)
        bindings = {key: request[key] for key in ("sourceName", "seedSha256", "planHash", "evaluatedAt")}
        bindings["selectedSourceRecordIds"] = [record["source_record_id"] for record in request["records"]]
        result = run(request, local_path(args.engine_root, directory=True), local_path(args.source_db))
    except (Blocked, ValueError, OSError, sqlite3.Error, ImportError) as error:
        result = {"version": version, "status": "BLOCKED", **bindings, "reason": str(error), "guardrails": dict(GUARDRAILS)}
    except Exception as error:
        result = {"version": version, "status": "FAIL", **bindings, "reason": type(error).__name__ + ": " + str(error), "guardrails": dict(GUARDRAILS)}
    result.pop("reportHash", None)
    result["reportHash"] = digest(result)
    sys.stdout.write(json.dumps(result, ensure_ascii=True, sort_keys=True, allow_nan=False) + "\n")
    return 0 if result["status"] == "PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())
