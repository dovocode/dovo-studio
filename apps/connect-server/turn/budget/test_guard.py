import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import guard


class GuardTests(unittest.TestCase):
    def test_readiness_is_bound_to_current_boot_and_tls_port(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with patch.object(guard, 'BOOT_ID', root / 'boot'):
                guard.BOOT_ID.write_text('first-boot\n')
                guard.publish_ready(root, 5349)
                self.assertEqual((root / 'ready').read_text(), guard.readiness(5349))
                self.assertNotEqual((root / 'ready').read_text(), guard.readiness(8443))
                guard.BOOT_ID.write_text('second-boot\n')
                self.assertNotEqual((root / 'ready').read_text(), guard.readiness(5349))
                (root / 'ready.next').write_text('interrupted-publication')
                (root / 'ready.next').chmod(0o444)
                guard.publish_ready(root, 5349)
                self.assertEqual((root / 'ready').read_text(), guard.readiness(5349))
                self.assertEqual((root / 'ready').stat().st_mode & 0o777, 0o444)

    def test_reservations_survive_restart_and_never_exceed_daily_cap(self):
        with tempfile.TemporaryDirectory() as directory:
            ledger = guard.Ledger(directory)
            grants = [ledger.reserve('2026-10-20') for _ in range(751)]
            self.assertEqual(sum(grants), 750_000_000_000)
            self.assertEqual(grants[-1], 0)
            ledger.lock.close()
            restarted = guard.Ledger(directory)
            self.assertEqual(restarted.reserve('2026-10-20'), 0)
            self.assertEqual(restarted.reserve('2026-10-21'), guard.CHUNK)
            # The new day also charges the prior kernel reservation across midnight.
            self.assertEqual(json.loads(Path(directory, 'state.json').read_text())['reserved'], 2 * guard.CHUNK)
            with self.assertRaises(ValueError):
                restarted.reserve('2026-10-20')
            restarted.lock.close()

    def test_invalid_disk_state_and_concurrent_guard_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            ledger = guard.Ledger(directory)
            with self.assertRaises(BlockingIOError):
                guard.Ledger(directory)
            for state in [{'day': 'broken', 'reserved': 0}, {'day': '2026-10-20', 'reserved': -1},
                          {'day': '2026-10-20', 'reserved': True},
                          {'day': '2026-10-21', 'reserved': 0},
                          {'day': '2026-10-20', 'reserved': guard.LIMIT + 1},
                          {'day': '20261020', 'reserved': 0}]:
                Path(directory, 'state.json').write_text(json.dumps(state))
                with self.assertRaises(ValueError):
                    ledger.reserve('2026-10-20')
            ledger.lock.close()

    def test_migrates_monthly_ledger_without_resetting_the_allowance(self):
        with tempfile.TemporaryDirectory() as directory:
            ledger = guard.Ledger(directory)
            path = Path(directory, 'state.json')
            path.write_text(json.dumps({'month': '2026-10', 'reserved': 5 * guard.CHUNK}))
            self.assertEqual(ledger.reserve('2026-10-20'), guard.CHUNK)
            self.assertEqual(json.loads(path.read_text()),
                             {'day': '2026-10-20', 'reserved': 6 * guard.CHUNK})
            self.assertEqual(ledger.reserve('2026-10-20'), guard.CHUNK)
            self.assertEqual(json.loads(path.read_text())['reserved'], 7 * guard.CHUNK)
            # A previously exhausted month must stay exhausted on migration day.
            path.write_text(json.dumps({'month': '2026-10', 'reserved': guard.LIMIT}))
            self.assertEqual(ledger.reserve('2026-10-20'), 0)
            self.assertEqual(ledger.reserve('2026-10-21'), guard.CHUNK)
            for state in [{'month': '2026-11', 'reserved': 0},
                          {'month': '2026-9', 'reserved': 0},
                          {'month': 'broken', 'reserved': 0}]:
                path.write_text(json.dumps(state))
                with self.assertRaises(ValueError):
                    ledger.reserve('2026-10-20')
            path.write_text(json.dumps({'month': '2026-09', 'reserved': 5 * guard.CHUNK}))
            self.assertEqual(ledger.reserve('2026-10-20'), guard.CHUNK)
            self.assertEqual(json.loads(path.read_text())['reserved'], 2 * guard.CHUNK)
            ledger.lock.close()

    def test_daily_budget_handles_month_and_year_boundaries(self):
        with tempfile.TemporaryDirectory() as directory:
            ledger = guard.Ledger(directory)
            for current in ['2026-10-31', '2026-11-01', '2026-12-31', '2027-01-01']:
                self.assertEqual(ledger.reserve(current), guard.CHUNK)
                self.assertEqual(json.loads(ledger.path.read_text())['day'], current)
            with self.assertRaises(ValueError):
                ledger.reserve('2026-12-31')
            ledger.lock.close()

    def test_disk_commit_happens_before_authorizing_new_traffic(self):
        with tempfile.TemporaryDirectory() as directory:
            ledger = guard.Ledger(directory)
            with patch.object(guard.os, 'fsync', side_effect=OSError('disk failed')):
                with self.assertRaises(OSError):
                    ledger.reserve('2026-10-20')
            self.assertFalse(Path(directory, 'state.json').exists())
            ledger.lock.close()

    def test_kernel_table_is_replaced_atomically_and_matches_all_turn_egress(self):
        with patch.object(guard, 'nft', side_effect=[json.dumps({'nftables': [{'table': {'family': 'inet', 'name': guard.TABLE}}]}), '']) as nft:
            guard.install(guard.CHUNK, 5349)
            script = nft.call_args.kwargs['script']
            self.assertTrue(script.startswith('delete table inet dovo_turn_budget\n'))
            self.assertIn('until 1000000000 bytes', script)
            self.assertIn('3478, 5349, 20000-20099', script)
            self.assertIn('quota name "egress" return; drop;', script)
            self.assertIn('priority -10', script)
        for port in [0, 3478, 20000, 65536]:
            with self.assertRaises(ValueError):
                guard.rules(0, port)

    def test_own_host_is_isolated_without_blocking_relay_to_relay_and_nat_ips_are_validated(self):
        with patch.dict(guard.os.environ, {'DOVO_TURN_PUBLIC_IPS': '152.53.5.17,2001:db8::1'}):
            rules = guard.rules(1000, 5349)
            self.assertIn('fib daddr type local udp dport != 20000-20099 drop', rules)
            self.assertLess(rules.index('fib daddr type local'), rules.index('jump relay'))
            self.assertIn('ip daddr 152.53.5.17 udp dport != 20000-20099 drop', rules)
            self.assertIn('ip6 daddr 2001:db8::1 udp dport != 20000-20099 drop', rules)
            self.assertIn(':security-v5-daily:152.53.5.17,2001:db8::1', guard.readiness(5349))
        with patch.dict(guard.os.environ, {'DOVO_TURN_PUBLIC_IPS': '1.2.3.4; accept'}):
            with self.assertRaises(ValueError):
                guard.rules(1000, 5349)
        with patch.dict(guard.os.environ, {'DOVO_TURN_PUBLIC_IPS': 'fe80::1%eth0'}):
            with self.assertRaisesRegex(ValueError, 'zone identifiers'):
                guard.rules(1000, 5349)
        with patch.dict(guard.os.environ, {'DOVO_TURN_PUBLIC_IPS': ''}):
            rules = guard.rules(1000, 5349)
            self.assertIn('fib daddr type local', rules)
            self.assertNotIn('ip daddr', rules)


if __name__ == '__main__':
    unittest.main()
