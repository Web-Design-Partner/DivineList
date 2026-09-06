"""Offline regression tests: all writable databases live in per-test temp dirs.

Set DIVINELIST_TEST_ENGINE_ROOT to use another reviewed engine checkout; otherwise
the existing Windows engine path is used. Run with Python -B -I.
"""

from __future__ import annotations

from contextlib import closing
import hashlib
import importlib.util
import json
import marshal
import os
from pathlib import Path
import shutil
import sqlite3
import struct
import subprocess
import sys
import tempfile
import unittest


sys.dont_write_bytecode = True
PROJECT_ROOT = Path(__file__).resolve().parents[1]
ENGINE_ROOT = Path(os.environ.get(
    "DIVINELIST_TEST_ENGINE_ROOT",
    r"C:\Users\cozys\Documents\Goteborgs-Foretagskarta-Engine",
)).resolve()
WORKER = PROJECT_ROOT / "scripts" / "lib" / "import-dry-run.py"
sys.path.insert(0, str(ENGINE_ROOT))

from local_engine.database import initialize  # noqa: E402
from local_engine.importer import Importer  # noqa: E402
from local_engine.constants import RULESET_VERSION  # noqa: E402
from local_engine.contacts import create_contact_candidate  # noqa: E402


EVALUATED_AT = "2026-09-04T12:00:00.000Z"
SOURCE_NAME = "divinelist-seeds:wave-001"


def candidate() -> dict[str, object]:
    return {
        "source_record_id": "CAND:wave-001:synthetic-cafe-haga",
        "company_name": "Synthetic Café Fixture",
        "workplace_name": "Synthetic Café Fixture — Haga",
        "street_address": "Fixturegatan 1",
        "postal_code": "413 01",
        "municipality_code": "1480",
        "gothenburg_status": "unresolved",
        "verification_status": "unresolved",
        "needs_manual_review": True,
        "verification_note": "Synthetic test record; not a human identity decision.",
        "segment": "restaurang/café",
        "website": "https://www.cafe-fixture.se/",
        "domain_status": "unresolved",
        "domain_confidence": 0,
        "source_url": "https://www.cafe-fixture.se/",
        "evidence_urls": ["https://www.cafe-fixture.se/"],
        "observed_at": "2026-09-04T10:00:00.000Z",
    }


def request() -> dict[str, object]:
    return {
        "version": "divinelist.import-dry-run-request.v1",
        "seedSha256": "sha256:" + "a" * 64,
        "planHash": "sha256:" + "b" * 64,
        "evaluatedAt": EVALUATED_AT,
        "sourceName": SOURCE_NAME,
        "records": [candidate()],
    }


def file_digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def sequence_request() -> dict:
    payload = request()
    payload["version"] = "divinelist.import-dry-run-sequence-request.v1"
    payload["packets"] = []
    number = 0
    for index, size in enumerate((1, 3, 1)):
        records = []
        for _ in range(size):
            number += 1
            record = candidate()
            record.update({
                "source_record_id": f"CAND:sequence:{number}",
                "company_name": f"Synthetic Sequence {number}",
                "workplace_name": f"Synthetic Sequence {number}",
                "street_address": f"Fixturegatan {number}",
                "website": f"https://sequence-{number}.se/",
                "source_url": f"https://sequence-{number}.se/",
                "evidence_urls": [f"https://sequence-{number}.se/"],
            })
            records.append(record)
        payload["packets"].append({"packetId": f"packet-{index + 1}",
                                   "seedSha256": "sha256:" + "a" * 64,
                                   "planHash": "sha256:" + "b" * 64, "records": records})
    bind_sequence(payload)
    return payload


def bind_sequence(payload: dict) -> None:
    payload["records"] = [record for packet in payload["packets"] for record in packet["records"]]
    for field in ("seedSha256", "planHash"):
        value = [{"packetId": packet["packetId"], field: packet[field]} for packet in payload["packets"]]
        payload[field] = "sha256:" + hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()


class ImportDryRunTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="divinelist-dry-run-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.root / "synthetic-source.sqlite3"
        self.initialize_fixture(self.source)

    @staticmethod
    def initialize_fixture(path: Path, through_version: int | None = None) -> None:
        with closing(sqlite3.connect(path, isolation_level=None)) as connection:
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA foreign_keys=ON")
            initialize(connection, ENGINE_ROOT / "migrations", through_version=through_version)

    def invoke(
        self,
        payload: dict[str, object] | None = None,
        *,
        raw_input: str | None = None,
        source: Path | None = None,
        engine_root: Path | None = None,
    ) -> tuple[subprocess.CompletedProcess[str], dict[str, object]]:
        completed = subprocess.run(
            [
                sys.executable,
                "-B",
                "-I",
                str(WORKER),
                "--engine-root",
                str(engine_root or ENGINE_ROOT),
                "--source-db",
                str(source or self.source),
            ],
            input=raw_input if raw_input is not None else json.dumps(payload or request()),
            capture_output=True,
            encoding="utf-8",
            timeout=30,
            check=False,
        )
        self.assertTrue(completed.stdout.strip(), completed.stderr)
        try:
            report = json.loads(completed.stdout)
        except json.JSONDecodeError as error:
            self.fail(f"Worker must emit one JSON object: {error}: {completed.stdout!r}")
        self.assertIsInstance(report, dict)
        return completed, report

    def assert_blocked(self, **arguments: object) -> dict[str, object]:
        before = file_digest(self.source)
        completed, report = self.invoke(**arguments)
        self.assertEqual(completed.returncode, 2, report)
        self.assertEqual(report["status"], "BLOCKED", report)
        self.assertEqual(file_digest(self.source), before)
        return report

    def assert_guardrails(self, report: dict[str, object]) -> None:
        self.assertEqual(report["guardrails"], {
            "sourceReadOnly": True,
            "simulationDatabase": ":memory:",
            "runtimeWrites": False,
            "networkRequests": False,
            "applicationFileWrites": False,
            "sqliteOperatingSystemIoNotAttested": True,
            "queueWrites": False,
            "outreachAuthorized": False,
            "advertisingAuthorized": False,
            "publicationAuthorized": False,
            "humanDecisionsRecorded": False,
            "identityEligibilityChanged": False,
            "activeVaultWrites": False,
            "schemaMigrationsPerformed": False,
            "bytecodeWrites": False,
            "simulatedImportOnly": True,
        })

    def populate_existing_candidate(self, source_name: str = SOURCE_NAME) -> str:
        with closing(sqlite3.connect(self.source, isolation_level=None)) as connection:
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA foreign_keys=ON")
            imported = Importer(connection).import_records([candidate()], source_name, queue=False)
            self.assertEqual(imported.imported, 1)
            return connection.execute("SELECT workplace_uid FROM workplaces").fetchone()[0]

    def test_first_import_is_memory_only_and_source_bytes_do_not_change(self) -> None:
        before = file_digest(self.source)
        before_paths = sorted(str(path.relative_to(self.root)) for path in self.root.rglob("*"))
        completed, report = self.invoke()
        self.assertEqual(completed.returncode, 0, report)
        self.assertEqual(report["status"], "PASS", report)
        self.assertEqual(report["version"], "divinelist.import-dry-run.v1")
        self.assertEqual(report["sourceName"], SOURCE_NAME)
        self.assertEqual(report["seedSha256"], request()["seedSha256"])
        self.assertEqual(report["planHash"], request()["planHash"])
        self.assert_guardrails(report)
        self.assertEqual(report["source"]["logicalBefore"], report["source"]["logicalAfter"])
        self.assertTrue(report["source"]["unchanged"])
        self.assertEqual(report["firstImport"]["read"], 1)
        self.assertEqual(report["firstImport"]["imported"], 1)
        self.assertEqual(report["firstImport"]["queued"], 0)
        self.assertEqual(report["firstImport"]["conflicts"], 0)
        self.assertEqual(len(report["candidates"]), 1)
        identity = report["candidates"][0]
        self.assertEqual(identity["sourceRecordId"], candidate()["source_record_id"])
        self.assertEqual(identity["gothenburgStatus"], "unresolved")
        self.assertEqual(identity["verificationStatus"], "unresolved")
        self.assertTrue(identity["needsManualReview"])
        self.assertEqual(identity["domainConfidence"], 0)
        self.assertEqual(identity["manualDecision"], "pending")
        self.assertFalse(identity["qualifiedForContact"])
        self.assertTrue(report["source"]["familyUnchanged"])
        self.assertEqual(report["source"]["familyBefore"], report["source"]["familyAfter"])
        self.assertEqual(file_digest(self.source), before)
        self.assertEqual(
            sorted(str(path.relative_to(self.root)) for path in self.root.rglob("*")),
            before_paths,
        )
        with closing(sqlite3.connect(self.source)) as connection:
            for table in ["companies", "workplaces", "websites", "source_observations", "scan_jobs", "manual_fields"]:
                self.assertEqual(connection.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0], 0)

    def test_second_import_is_structurally_idempotent_and_reports_real_churn(self) -> None:
        completed, report = self.invoke()
        self.assertEqual(completed.returncode, 0, report)
        self.assertEqual(report["secondImport"]["read"], 1)
        self.assertEqual(report["secondImport"]["imported"], 0)
        self.assertEqual(report["secondImport"]["duplicates"], 1)
        self.assertEqual(report["secondImport"]["queued"], 0)
        self.assertTrue(report["idempotence"]["structural"])
        self.assertTrue(report["idempotence"]["sourceObservations"])
        self.assertFalse(report["idempotence"]["exactRows"])
        self.assertTrue(report["idempotence"]["timestampOnly"])
        self.assertTrue(report["idempotence"]["sequenceChanges"])
        self.assertNotEqual(report["firstImport"]["simulatedAt"], report["secondImport"]["simulatedAt"])
        sequence_diff = next(change for change in report["diff"]["second"] if change["table"] == "sqlite_sequence")
        self.assertEqual(sequence_diff["changedColumns"], ["seq"])
        for change in report["diff"]["second"]:
            if change["table"] != "sqlite_sequence":
                self.assertEqual(change["created"], 0)
                self.assertEqual(change["deleted"], 0)
                self.assertEqual(change["changedColumns"], ["updated_at"])

    def test_do_not_contact_blocks_simulation_and_cannot_be_cleared(self) -> None:
        self.populate_existing_candidate()
        with closing(sqlite3.connect(self.source, isolation_level=None)) as connection:
            connection.execute("UPDATE manual_fields SET do_not_contact=1")
        report = self.assert_blocked()
        self.assertIn("suppression", report["reason"].lower())
        self.assertNotIn("firstImport", report)
        with closing(sqlite3.connect(self.source)) as connection:
            self.assertEqual(connection.execute("SELECT do_not_contact FROM manual_fields").fetchone()[0], 1)

    def test_active_suppression_blocks_before_any_memory_import(self) -> None:
        uid = self.populate_existing_candidate("older-synthetic-source")
        with closing(sqlite3.connect(self.source, isolation_level=None)) as connection:
            connection.execute(
                "INSERT INTO contact_suppressions(suppression_uid,workplace_uid,reason,active,created_at) VALUES(?,?,?,?,?)",
                ("SUP:test-only", uid, "Synthetic suppression test", 1, EVALUATED_AT),
            )
        report = self.assert_blocked()
        self.assertIn("suppression", report["reason"].lower())
        self.assertNotIn("firstImport", report)

    def test_contact_candidate_dnc_alone_blocks_before_import(self) -> None:
        # V8 allowed setting a contact's DNC flag; V9 then made all contact rows
        # immutable. Construct that legitimate historical state in a temp DB,
        # with current exact schema and no other suppression/DNC flags.
        historical = self.root / "synthetic-historical-contact.sqlite3"
        self.initialize_fixture(historical, through_version=8)
        with closing(sqlite3.connect(historical, isolation_level=None)) as connection:
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA foreign_keys=ON")
            legacy = candidate()
            legacy.update({
                "source_record_id": "CAND:legacy:synthetic-contact-only",
                "company_name": "Synthetic historical contact fixture",
                "workplace_name": "Synthetic historical contact fixture",
                "street_address": "Fixturegatan 99",
                "gothenburg_status": "verified",
                "verification_status": "verified_current",
                "needs_manual_review": False,
                "website": "https://contact-fixture.se/",
                "source_url": "https://contact-fixture.se/",
                "evidence_urls": ["https://contact-fixture.se/"],
                "domain_status": "verified_primary",
                "domain_confidence": 0.95,
            })
            Importer(connection).import_records([legacy], "historical-synthetic-fixture", queue=False)
            workplace = connection.execute("SELECT * FROM workplaces").fetchone()
            website_uid = connection.execute("SELECT website_uid FROM websites").fetchone()[0]
            connection.execute(
                "INSERT INTO scan_runs(scan_run_id,website_uid,scan_profile_version,ruleset_version,state,"
                "content_fingerprint,evidence_confidence,need_score,started_at,completed_at,created_at) "
                "VALUES('SYNTHETIC:scan',?,'safe-screen-v1',?,'current','synthetic-contact',1,50,?,?,?)",
                (website_uid, RULESET_VERSION, EVALUATED_AT, EVALUATED_AT, EVALUATED_AT),
            )
            connection.execute(
                "INSERT INTO workplace_scan_scores VALUES('SYNTHETIC:scan',?,50,'behover_hjalp_med_hemsidan',1,100,100,65,0,?)",
                (workplace["workplace_uid"], EVALUATED_AT),
            )
            connection.execute(
                "INSERT INTO scan_checks VALUES('SYNTHETIC:scan','manual_primary_path','PASS','{}',?)",
                (EVALUATED_AT,),
            )
            connection.execute(
                "INSERT INTO findings VALUES('SYNTHETIC:finding','SYNTHETIC:scan','cta_conversion','cta',"
                "'Synthetic fixture only','serious','high','direct','https://contact-fixture.se/','{}',?)",
                (EVALUATED_AT,),
            )
            connection.execute("UPDATE manual_fields SET qualified_for_contact=1,manual_decision='approved'")
            create_contact_candidate(
                connection,
                workplace_uid=workplace["workplace_uid"],
                company_uid=workplace["company_uid"],
                name="Synthetic test contact",
                public_professional_role="Synthetic test role",
                professional_email="nobody@example.invalid",
                professional_direct_phone=None,
                first_party_source_url="https://contact-fixture.se/",
                purpose="Offline fixture only; never outreach",
                information_notice_status="not_applicable",
                verified_at=EVALUATED_AT,
                explicit_compliance_validation=True,
            )
            connection.execute("UPDATE contact_candidates SET do_not_contact=1")
            initialize(connection, ENGINE_ROOT / "migrations")
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM manual_fields WHERE do_not_contact=1").fetchone()[0], 0)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM contact_suppressions").fetchone()[0], 0)
            self.assertEqual(connection.execute("SELECT COUNT(*) FROM contact_candidates WHERE do_not_contact=1").fetchone()[0], 1)
        before = file_digest(historical)
        report = self.assert_blocked(source=historical)
        self.assertEqual(report["suppressionCheck"]["contactCandidateDoNotContactRows"], 1)
        self.assertEqual(report["suppressionCheck"]["doNotContactRows"], 0)
        self.assertEqual(report["suppressionCheck"]["activeSuppressions"], 0)
        self.assertNotIn("firstImport", report)
        self.assertEqual(file_digest(historical), before)

    def test_wal_with_existing_sidecars_is_read_only_and_unchanged(self) -> None:
        with closing(sqlite3.connect(self.source, isolation_level=None)) as connection:
            self.assertEqual(connection.execute("PRAGMA journal_mode=WAL").fetchone()[0], "wal")
            connection.execute("PRAGMA wal_autocheckpoint=0")
            connection.execute(
                "INSERT INTO run_logs(run_log_id,command,status,summary,started_at,completed_at) "
                "VALUES('SYNTHETIC:wal','synthetic-test','PASS','Temp fixture only',?,?)",
                (EVALUATED_AT, EVALUATED_AT),
            )
            # SQLite may initialize a persistent SHM read mark on its first
            # reader. Warm that mark before taking this stable positive fixture.
            with closing(sqlite3.connect(self.source.as_uri() + "?mode=ro", uri=True)) as reader:
                reader.execute("BEGIN")
                reader.execute("SELECT COUNT(*) FROM sqlite_master").fetchone()
                reader.execute("ROLLBACK")
            family = [self.source, Path(str(self.source) + "-wal"), Path(str(self.source) + "-shm")]
            self.assertTrue(all(path.exists() for path in family))
            before = {path.name: file_digest(path) for path in family}
            completed, report = self.invoke()
            self.assertEqual(completed.returncode, 0, report.get("reason"))
            self.assertEqual(report["status"], "PASS")
            self.assertTrue(report["source"]["unchanged"])
            self.assertTrue(report["source"]["familyUnchanged"])
            self.assertEqual({path.name: file_digest(path) for path in family}, before)

    def test_wal_without_sidecars_blocks_without_creating_them(self) -> None:
        with closing(sqlite3.connect(self.source, isolation_level=None)) as connection:
            self.assertEqual(connection.execute("PRAGMA journal_mode=WAL").fetchone()[0], "wal")
        wal = Path(str(self.source) + "-wal")
        shm = Path(str(self.source) + "-shm")
        self.assertFalse(wal.exists())
        self.assertFalse(shm.exists())
        report = self.assert_blocked()
        self.assertIn("sidecars", report["reason"])
        self.assertFalse(wal.exists())
        self.assertFalse(shm.exists())

    def test_cold_wal_cannot_claim_no_change_if_sqlite_updates_a_read_mark(self) -> None:
        with closing(sqlite3.connect(self.source, isolation_level=None)) as connection:
            connection.execute("PRAGMA journal_mode=WAL")
            connection.execute("PRAGMA wal_autocheckpoint=0")
            connection.execute(
                "INSERT INTO run_logs(run_log_id,command,status,summary,started_at,completed_at) "
                "VALUES('SYNTHETIC:cold-wal','synthetic-test','PASS','Temp fixture only',?,?)",
                (EVALUATED_AT, EVALUATED_AT),
            )
            family = [self.source, Path(str(self.source) + "-wal"), Path(str(self.source) + "-shm")]
            before = {path.name: file_digest(path) for path in family}
            completed, report = self.invoke()
            after = {path.name: file_digest(path) for path in family}
            if before != after:
                self.assertEqual(completed.returncode, 2)
                self.assertEqual(report["status"], "BLOCKED")
                self.assertFalse(report["source"]["familyUnchanged"])
                self.assertIn("family changed", report["reason"])
            else:
                self.assertEqual(completed.returncode, 0, report.get("reason"))
                self.assertTrue(report["source"]["familyUnchanged"])
            self.assertTrue(report["guardrails"]["sqliteOperatingSystemIoNotAttested"])

    def test_existing_candidate_is_not_silently_rewritten(self) -> None:
        self.populate_existing_candidate()
        report = self.assert_blocked()
        self.assertIn("existing", report["reason"].lower())

    def test_candidate_from_another_source_conflict_is_not_auto_merged(self) -> None:
        self.populate_existing_candidate("older-synthetic-source")
        report = self.assert_blocked()
        self.assertIn("conflict", report["reason"].lower())

    def test_unknown_input_fields_and_unsafe_identity_promotions_are_blocked(self) -> None:
        cases = [
            ("human_approved", True),
            ("email", "person@cafe-fixture.se"),
            ("org_number", "19700101-1234"),
            ("needs_manual_review", False),
            ("gothenburg_status", "verified"),
            ("verification_status", "verified_current"),
            ("domain_status", "verified_primary"),
            ("domain_confidence", 0.9),
        ]
        for field, value in cases:
            with self.subTest(field=field):
                payload = request()
                payload["records"][0][field] = value
                self.assert_blocked(payload=payload)

    def test_private_or_credentialed_candidate_urls_are_blocked(self) -> None:
        for url in [
            "http://cafe-fixture.se/",
            "https://127.0.0.1/",
            "https://[::1]/",
            "https://10.0.0.1/",
            "https://127.1/",
            "https://0177.0.0.1/",
            "https://localhost/",
            "https://user:secret@cafe-fixture.se/",
            "file:///C:/secrets.txt",
        ]:
            with self.subTest(url=url):
                payload = request()
                payload["records"][0]["website"] = url
                payload["records"][0]["source_url"] = url
                payload["records"][0]["evidence_urls"] = [url]
                self.assert_blocked(payload=payload)

    def test_missing_source_is_blocked_without_creating_a_database(self) -> None:
        missing = self.root / "missing.sqlite3"
        self.assert_blocked(source=missing)
        self.assertFalse(missing.exists())

    def test_old_schema_is_blocked_without_auto_migration(self) -> None:
        old = self.root / "historical-schema.sqlite3"
        self.initialize_fixture(old, through_version=8)
        before = file_digest(old)
        self.assert_blocked(source=old)
        self.assertEqual(file_digest(old), before)

    def test_schema_drift_is_blocked_without_repairing_the_source(self) -> None:
        with closing(sqlite3.connect(self.source, isolation_level=None)) as connection:
            connection.execute("CREATE TABLE unexpected_table(value TEXT)")
        self.assert_blocked()

    def test_duplicate_candidate_ids_and_shared_domains_are_blocked(self) -> None:
        payload = request()
        payload["records"].append(candidate())
        self.assert_blocked(payload=payload)
        payload["records"][1]["source_record_id"] = "CAND:wave-001:second-branch"
        self.assert_blocked(payload=payload)

    def test_malformed_calendar_and_future_observations_are_blocked(self) -> None:
        for value in [
            "not-a-date",
            "2026-09-04T13:00:00.000Z",
            "2026-09-04T12:00:00.0000001Z",
            "2026-02-29T10:00:00.000Z",
            "2026-09-04T10:00:00",
        ]:
            with self.subTest(value=value):
                payload = request()
                payload["records"][0]["observed_at"] = value
                self.assert_blocked(payload=payload)

    def test_wrong_engine_root_cannot_execute_unreviewed_code(self) -> None:
        fake_root = self.root / "unreviewed-engine"
        fake_root.mkdir()
        self.assert_blocked(engine_root=fake_root)

    def copy_engine_fixture(self) -> Path:
        root = self.root / "pinned-engine-copy"
        package = root / "local_engine"
        package.mkdir(parents=True)
        for filename in ["__init__.py", "constants.py", "util.py", "normalize.py", "database.py", "importer.py"]:
            shutil.copy2(ENGINE_ROOT / "local_engine" / filename, package / filename)
        migrations = root / "migrations"
        migrations.mkdir()
        for migration in (ENGINE_ROOT / "migrations").glob("[0-9][0-9][0-9]_*.sql"):
            shutil.copy2(migration, migrations / migration.name)
        return root

    def test_modified_engine_source_is_blocked_before_execution(self) -> None:
        root = self.copy_engine_fixture()
        changed = root / "local_engine" / "__init__.py"
        changed.write_text("raise RuntimeError('UNREVIEWED_SOURCE_EXECUTED')\n", encoding="utf-8")
        report = self.assert_blocked(engine_root=root)
        self.assertIn("Unreviewed engine code", report["reason"])
        self.assertNotIn("UNREVIEWED_SOURCE_EXECUTED", report["reason"])

    def test_valid_but_unreviewed_bytecode_cannot_bypass_source_pins(self) -> None:
        root = self.copy_engine_fixture()
        source = root / "local_engine" / "__init__.py"
        metadata = source.stat()
        cache = Path(importlib.util.cache_from_source(str(source)))
        cache.parent.mkdir()
        bad_code = compile("raise RuntimeError('UNREVIEWED_BYTECODE_EXECUTED')", str(source), "exec")
        header = importlib.util.MAGIC_NUMBER + struct.pack("<III", 0, int(metadata.st_mtime), metadata.st_size)
        cache.write_bytes(header + marshal.dumps(bad_code))
        before = file_digest(cache)
        completed, report = self.invoke(engine_root=root)
        self.assertEqual(completed.returncode, 0, report.get("reason"))
        self.assertEqual(report["status"], "PASS")
        self.assertEqual(file_digest(cache), before)

    def test_request_contract_hashes_version_count_and_source_name_are_strict(self) -> None:
        cases = [
            ("version", "unknown"),
            ("seedSha256", "wrong"),
            ("planHash", "wrong"),
            ("sourceName", "ad-hoc-overwrite-source"),
            ("records", []),
            ("records", [candidate()] * 4),
            ("approved", True),
        ]
        for field, value in cases:
            with self.subTest(field=field):
                payload = request()
                payload[field] = value
                self.assert_blocked(payload=payload)

    def test_invalid_json_is_blocked_with_structured_output(self) -> None:
        self.assert_blocked(raw_input="{not-json")

    def test_duplicate_json_keys_and_nonfinite_numbers_are_blocked(self) -> None:
        text = json.dumps(request())
        self.assert_blocked(raw_input=text.replace('"records":', '"version":"duplicate", "records":', 1))
        self.assert_blocked(raw_input=text.replace('"domain_confidence": 0', '"domain_confidence": NaN', 1))


    def test_sequence_five_candidates_share_one_memory_database_and_full_replay(self) -> None:
        payload = sequence_request()
        before = file_digest(self.source)
        completed, report = self.invoke(payload)
        self.assertEqual(completed.returncode, 0, report)
        self.assertEqual(report["version"], "divinelist.import-dry-run-sequence.v1")
        self.assertTrue(report["sequence"]["sameMemoryDatabase"])
        steps = report["sequence"]["steps"]
        self.assertEqual([step["import"]["imported"] for step in steps], [1, 3, 1, 0, 0, 0])
        self.assertEqual([step["import"]["duplicates"] for step in steps], [0, 0, 0, 1, 3, 1])
        self.assertEqual([step["pass"] for step in steps], [1, 1, 1, 2, 2, 2])
        self.assertEqual(steps[0]["beforeLogicalHash"], report["source"]["logicalBefore"])
        for left, right in zip(steps, steps[1:]):
            self.assertEqual(left["afterLogicalHash"], right["beforeLogicalHash"])
        self.assertEqual(report["firstImport"]["imported"], 5)
        self.assertEqual(report["secondImport"]["imported"], 0)
        self.assertEqual(len({item["companyUid"] for item in report["candidates"]}), 5)
        self.assertEqual(len({item["workplaceUid"] for item in report["candidates"]}), 5)
        self.assertTrue(report["source"]["unchanged"])
        self.assertTrue(report["source"]["familyUnchanged"])
        self.assertEqual(file_digest(self.source), before)
        self.assert_guardrails(report)

    def test_sequence_rejects_cross_packet_ids_domains_and_packet_ids(self) -> None:
        for field in ("source_record_id", "website", "packetId"):
            with self.subTest(field=field):
                payload = sequence_request()
                first, second = payload["packets"][:2]
                if field == "packetId":
                    second[field] = first[field]
                elif field == "website":
                    second["records"][0][field] = "https://www.sequence-1.se/"
                    second["records"][0]["evidence_urls"] = ["https://www.sequence-1.se/"]
                else:
                    second["records"][0][field] = first["records"][0][field]
                bind_sequence(payload)
                report = self.assert_blocked(payload=payload)
                self.assertNotIn("source", report)

    def test_sequence_rejects_tampered_order_hashes_and_flattened_records(self) -> None:
        for field in ("seedSha256", "planHash", "records", "packets"):
            with self.subTest(field=field):
                payload = sequence_request()
                if field in ("seedSha256", "planHash"):
                    payload[field] = "sha256:" + "0" * 64
                else:
                    payload[field] = list(reversed(payload[field]))
                self.assert_blocked(payload=payload)

    def test_sequence_late_conflict_stops_without_source_changes_or_false_pass(self) -> None:
        payload = sequence_request()
        with closing(sqlite3.connect(self.source, isolation_level=None)) as connection:
            connection.row_factory = sqlite3.Row
            Importer(connection).import_records(payload["packets"][1]["records"], SOURCE_NAME, queue=False)
        report = self.assert_blocked(payload=payload)
        self.assertEqual(len(report["sequence"]["steps"]), 1)
        self.assertEqual(report["sequence"]["steps"][0]["packetId"], "packet-1")
        self.assertNotIn("firstImport", report)

    def test_sequence_keeps_packet_limit_and_rejects_empty_or_promoted_records(self) -> None:
        for kind in ("too_many_packets", "too_many_records", "empty_packet", "promoted"):
            with self.subTest(kind=kind):
                payload = sequence_request()
                if kind == "too_many_packets":
                    payload["packets"].append(payload["packets"][0])
                elif kind == "too_many_records":
                    payload["packets"][0]["records"] *= 4
                elif kind == "empty_packet":
                    payload["packets"][0]["records"] = []
                else:
                    payload["packets"][0]["records"][0]["verification_status"] = "verified_current"
                bind_sequence(payload)
                self.assert_blocked(payload=payload)

    def test_sequence_suppression_blocks_the_entire_sequence(self) -> None:
        self.populate_existing_candidate()
        with closing(sqlite3.connect(self.source, isolation_level=None)) as connection:
            connection.execute("UPDATE manual_fields SET do_not_contact=1")
        report = self.assert_blocked(payload=sequence_request())
        self.assertEqual(report["sequence"]["steps"], [])

    def test_each_replay_step_rejects_intermediate_changes_even_if_later_reverted(self) -> None:
        spec = importlib.util.spec_from_file_location("sequence_worker_test", WORKER)
        worker = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(worker)
        allowed = {"table": "companies", "created": 0, "deleted": 0, "changedColumns": ["updated_at"]}
        worker.assert_replay_changes([allowed])
        worker.assert_replay_changes([])
        for changes in ({"created": 1}, {"deleted": 1}, {"table": "source_observations"}, {"changedColumns": ["company_name"]}):
            with self.subTest(changes=changes):
                with self.assertRaises(worker.Blocked):
                    worker.assert_replay_changes([{**allowed, **changes}])


if __name__ == "__main__":
    unittest.main(verbosity=2)
