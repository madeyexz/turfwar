import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace

spec = importlib.util.spec_from_file_location('watcher', Path(__file__).with_name('watch-errors.py'))
watcher = importlib.util.module_from_spec(spec)
spec.loader.exec_module(watcher)


class WatcherTests(unittest.TestCase):
    def test_counts_without_exporting_log_text(self):
        self.assertEqual(watcher.counts('INFO fine\nERROR token=private\nthread panicked ERROR\npanic'), {'panic': 2, 'error': 1})
        self.assertEqual(watcher.counts('ERROR\n' * 2100), {'panic': 0, 'error': 2000})

    def test_optional_env_and_no_shell_evaluation(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'env'
            self.assertEqual(watcher.read_env(path), {})
            path.write_text('# comment\nWEBHOOK_URL="https://example.test/hook"\nADMIN_TOKEN=\'$(ignored)\'\n')
            self.assertEqual(watcher.read_env(path), {'WEBHOOK_URL': 'https://example.test/hook', 'ADMIN_TOKEN': '$(ignored)'})

    def test_cursors_advance_only_after_delivery_and_payloads_have_no_log_text(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'env'
            path.write_text('WEBHOOK_URL=https://example.test/hook\nADMIN_TOKEN=local-test\n')
            env = {'TURFWAR_ERROR_ENV': str(path), 'TURFWAR_ERROR_STATE': str(Path(d) / 'state')}
            with patch.dict(watcher.os.environ, env), patch.object(watcher.time, 'time', return_value=1000), patch.object(watcher.subprocess, 'run', return_value=SimpleNamespace(stdout='ERROR token=secret\nthread panicked', stderr='')), patch.object(watcher, 'post', side_effect=OSError):
                with self.assertRaises(OSError):
                    watcher.main()
                self.assertFalse((Path(d) / 'state/webhook').exists())
            with patch.dict(watcher.os.environ, env), patch.object(watcher.time, 'time', return_value=1000), patch.object(watcher.subprocess, 'run', return_value=SimpleNamespace(stdout='ERROR token=secret\nthread panicked', stderr='')), patch.object(watcher, 'post') as send:
                watcher.main()
                self.assertEqual(send.call_count, 3)
                self.assertNotIn('secret', str(send.call_args_list))
                self.assertNotIn('local-test', str(send.call_args_list[0]))
                self.assertEqual((Path(d) / 'state/webhook').read_text(), '1000')
                self.assertEqual((Path(d) / 'state/database').read_text(), '1000')


if __name__ == '__main__':
    unittest.main()
