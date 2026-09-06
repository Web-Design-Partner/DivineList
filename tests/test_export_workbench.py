"""Read-only inventory export tests. All writable DBs are synthetic temp files."""
from __future__ import annotations

from contextlib import closing
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.dont_write_bytecode = True
PROJECT_ROOT = Path(__file__).resolve().parents[1]
ENGINE_ROOT = Path(os.environ.get("DIVINELIST_TEST_ENGINE_ROOT", r"C:\Users\cozys\Documents\Goteborgs-Foretagskarta-Engine"))
WORKER = PROJECT_ROOT / "scripts" / "export-workbench.py"
spec = importlib.util.spec_from_file_location("workbench_export", WORKER)
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
sys.path.insert(0, str(ENGINE_ROOT))
from local_engine.database import initialize  # noqa: E402

NOW = "2026-09-04T15:00:00.000Z"


class ExportWorkbenchTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="divinelist-workbench-test-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.db = self.root / "synthetic.sqlite3"
        with closing(sqlite3.connect(self.db, isolation_level=None)) as connection:
            connection.row_factory = sqlite3.Row
            initialize(connection, ENGINE_ROOT / "migrations")

    def add_company(self):
        with closing(sqlite3.connect(self.db, isolation_level=None)) as connection:
            connection.execute("INSERT INTO companies(company_uid,legal_name,company_name,created_at,updated_at) VALUES ('CO:fixture','Private legal fixture','Syntetiskt Café',?,?)", (NOW, NOW))
            connection.execute("INSERT INTO workplaces(workplace_uid,company_uid,workplace_name,municipality_code,verification_note,created_at,updated_at) VALUES ('WP:fixture','CO:fixture','Café — Haga','1480','PRIVATE-NOTE',?,?)", (NOW, NOW))
            connection.execute("INSERT INTO websites(website_uid,canonical_url,origin,host,registrable_domain,created_at,updated_at) VALUES ('WEB:fixture','https://fixture.se/','https://fixture.se','fixture.se','fixture.se',?,?)", (NOW, NOW))
            connection.execute("INSERT INTO workplace_sites(workplace_uid,website_uid,is_primary,created_at,updated_at) VALUES ('WP:fixture','WEB:fixture',1,?,?)", (NOW, NOW))
            connection.execute("INSERT INTO manual_fields(workplace_uid,manual_notes,updated_at) VALUES ('WP:fixture','SECRET-PERSONAL-NOTE',?)", (NOW,))

    def export(self):
        with patch.object(worker, "utc_now", return_value=NOW):
            return worker.export_snapshot(str(self.db), str(ENGINE_ROOT))

    def test_empty_snapshot_is_readonly_not_production_pass(self):
        before = worker.database_family(self.db)
        result = self.export()
        self.assertEqual(result["companies"], [])
        self.assertNotIn("status", result)
        self.assertNotIn("productionReady", result)
        self.assertEqual(before, worker.database_family(self.db))

    def test_company_fields_are_minimal_and_keep_unknown_state(self):
        self.add_company()
        result = self.export()
        item = result["companies"][0]
        self.assertEqual(item["name"], "Syntetiskt Café")
        self.assertIsNone(item["latestScan"])
        self.assertIn("analysis_batch_required", item["reasonCodes"])
        self.assertIn("gothenburg_identity_unverified", item["reasonCodes"])
        self.assertIn("workplace_identity_unverified", item["reasonCodes"])
        self.assertIn("domain_unverified", item["reasonCodes"])
        self.assertNotIn("PRIVATE", json.dumps(result))
        self.assertNotIn("SECRET", json.dumps(result))
        self.assertNotIn("legal", json.dumps(result))
        self.assertEqual(set(item), {"companyUid", "workplaceUid", "name", "workplaceName", "domain", "reasonCodes", "latestScan"})

    def test_export_does_not_change_database_or_identity_flags(self):
        self.add_company()
        before = worker.database_family(self.db)
        self.export()
        self.assertEqual(before, worker.database_family(self.db))
        with closing(sqlite3.connect(self.db)) as connection:
            self.assertEqual(connection.execute("SELECT verification_status,needs_manual_review FROM workplaces").fetchone(), ("unresolved", 1))

    def test_readonly_connection_rejects_writes_and_attach(self):
        with closing(worker.open_readonly(self.db)) as connection:
            for statement in ("CREATE TABLE forbidden(id)", "DELETE FROM companies", "ATTACH DATABASE ':memory:' AS other", "PRAGMA writable_schema=ON"):
                with self.assertRaises(sqlite3.DatabaseError):
                    connection.execute(statement)

    def test_schema_drift_is_blocked_without_migration(self):
        with closing(sqlite3.connect(self.db)) as connection:
            connection.execute("CREATE TABLE unexpected(id)")
        before = worker.database_family(self.db)
        with self.assertRaisesRegex(worker.Blocked, "schema"):
            self.export()
        self.assertEqual(before, worker.database_family(self.db))

    def test_migration_history_drift_is_blocked(self):
        with closing(sqlite3.connect(self.db, isolation_level=None)) as connection:
            connection.execute("DELETE FROM schema_migrations WHERE version=9")
        with self.assertRaisesRegex(worker.Blocked, "Migration"):
            self.export()

    def test_bounded_inventory_has_no_silent_truncation(self):
        self.add_company()
        with patch.object(worker, "MAX_COMPANIES", 0):
            with self.assertRaisesRegex(worker.Blocked, "10000"):
                self.export()

    def test_adapter_is_static_and_cannot_execute_source(self):
        marker = self.root / "should-not-exist"
        source = f"open({str(marker)!r}, 'w').write('unsafe')\n_fact_mapping('seo.title_present', True, 'html')\n".encode()
        self.assertEqual(worker.extract_fact_keys(source), ["seo.title_present"])
        self.assertFalse(marker.exists())

    def test_dynamic_adapter_keys_fail_closed(self):
        with self.assertRaisesRegex(worker.Blocked, "Dynamic"):
            worker.extract_fact_keys(b"_fact_mapping(computed_key, True, 'html')")

    def test_adapter_source_drift_is_not_accepted_from_its_own_metadata(self):
        root = self.root / "changed-engine"
        (root / "local_engine").mkdir(parents=True)
        (root / "local_engine" / "divinelist.py").write_text("_fact_mapping('transport.tls_valid', True, 'headers')", encoding="utf-8")
        with self.assertRaisesRegex(worker.Blocked, "Adapter source changed"):
            worker.inspect_adapter(root)

    def test_source_and_envelope_hashes_cover_the_actual_metadata(self):
        self.add_company()
        result = self.export()
        self.assertEqual(result["sourceDigest"], worker.digest({"companies": result["companies"], "sourceSchemaHash": worker.SCHEMA_HASH, "sourceVersion": worker.SOURCE_VERSION}))
        stored_hash = result.pop("snapshotHash")
        self.assertEqual(stored_hash, worker.digest(result))

    def test_contact_protection_is_a_boolean_reason_not_private_data(self):
        self.add_company()
        with closing(sqlite3.connect(self.db, isolation_level=None)) as connection:
            connection.execute("UPDATE manual_fields SET do_not_contact=1")
        item = self.export()["companies"][0]
        self.assertIn("contact_restriction_present", item["reasonCodes"])

    def test_latest_collection_metadata_is_not_an_audit_approval(self):
        self.add_company()
        with closing(sqlite3.connect(self.db, isolation_level=None)) as connection:
            connection.execute("INSERT INTO scan_runs(scan_run_id,website_uid,scan_profile_version,ruleset_version,state,started_at,completed_at,created_at) VALUES ('SCAN:fixture','WEB:fixture','synthetic','synthetic','needs_manual_review',?,?,?)", (NOW, NOW, NOW))
            connection.execute("INSERT INTO collection_run_details(scan_run_id,execution_status,result_status,render_fidelity,created_at) VALUES ('SCAN:fixture','completed','needs_review','full',?)", (NOW,))
        item = self.export()["companies"][0]
        self.assertEqual(item["latestScan"]["executionStatus"], "completed")
        self.assertIn("collection_review_required", item["reasonCodes"])
        self.assertIn("analysis_batch_required", item["reasonCodes"])
        self.assertNotIn("confirmed", item)

    def test_source_drift_during_read_discards_snapshot(self):
        before = worker.database_family(self.db)
        after = dict(before, main={"bytes": 0, "sha256": "changed"})
        with patch.object(worker, "database_family", side_effect=[before, after]):
            with self.assertRaisesRegex(worker.Blocked, "changed during read"):
                self.export()

    def test_no_overwrite_and_no_path_escape_in_report_output(self):
        reports = self.root / "reports"
        reports.mkdir()
        target_root = reports / "workbench"
        snapshot = self.export()
        target = worker.write_new_report("safe-snapshot", snapshot, report_root=target_root)
        before = hashlib.sha256(target.read_bytes()).hexdigest()
        with self.assertRaises(FileExistsError):
            worker.write_new_report("safe-snapshot", snapshot, report_root=target_root)
        for value in ("../active-vault", "public/data.json", "C:\\active-vault", "unsafe.json", ".."):
            with self.assertRaises(worker.Blocked):
                worker.write_new_report(value, snapshot, report_root=target_root)
        self.assertEqual(before, hashlib.sha256(target.read_bytes()).hexdigest())

    def test_missing_source_never_creates_a_database(self):
        missing = self.root / "never-created.sqlite3"
        with self.assertRaises(FileNotFoundError):
            worker.export_snapshot(str(missing), str(ENGINE_ROOT))
        self.assertFalse(missing.exists())

    def test_text_bounds_match_javascript_utf16_and_reject_controls(self):
        for value in ("\U0001f916" * 126, "wrong\nname", "\ud800", "x" * 251):
            with self.assertRaises(worker.Blocked):
                worker.checked_text(value, 250, "synthetic name")

    def test_cli_defaults_to_stdout_and_no_report_write(self):
        self.add_company()
        before = sorted((PROJECT_ROOT / "reports").glob("workbench/*"))
        completed = subprocess.run([sys.executable, "-B", "-I", str(WORKER), "--source-db", str(self.db), "--engine-root", str(ENGINE_ROOT)], capture_output=True, text=True, encoding="utf-8", timeout=30, check=False)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        self.assertEqual(json.loads(completed.stdout)["version"], worker.VERSION)
        self.assertEqual(json.loads(completed.stdout)["companies"][0]["name"], "Syntetiskt Café")
        self.assertEqual(before, sorted((PROJECT_ROOT / "reports").glob("workbench/*")))

    def test_python_output_validates_in_real_typescript_parser(self):
        self.add_company()
        code = """
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
const result = await build({entryPoints:['lib/workbench/snapshot.ts'], bundle:true, write:false, platform:'node', format:'esm'});
const api = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
const snapshot = api.parseWorkbenchSnapshotJson(readFileSync(0, 'utf8'), '2026-09-04T15:00:00.000Z');
const rules = api.getWorkbenchRuleCoverage(snapshot);
console.log(JSON.stringify({companies:snapshot.companies.length, name:snapshot.companies[0].name, candidateRules:rules.filter(row => row.status === 'candidate').length, mappedCandidates:rules.filter(row => row.status === 'candidate' && row.missingAdapterFacts.length === 0).length}));
"""
        node = shutil.which("node")
        self.assertIsNotNone(node, "Node is required for the cross-language contract test")
        completed = subprocess.run([node, "--input-type=module", "-e", code], input=worker.canonical(self.export()), cwd=PROJECT_ROOT, capture_output=True, text=True, encoding="utf-8", timeout=30, check=False)
        self.assertEqual(completed.returncode, 0, completed.stderr[:1500])
        self.assertEqual(json.loads(completed.stdout), {"companies": 1, "name": "Syntetiskt Café", "candidateRules": 50, "mappedCandidates": 10})


if __name__ == "__main__":
    unittest.main()
