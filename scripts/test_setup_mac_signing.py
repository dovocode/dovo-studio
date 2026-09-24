import importlib.util
import pathlib
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('signing', pathlib.Path(__file__).with_name('setup-mac-signing.py'))
signing = importlib.util.module_from_spec(spec)
spec.loader.exec_module(signing)


class CertificateImportTests(unittest.TestCase):
    def test_modern_and_keychain_legacy_exports_and_wrong_password(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            def openssl(args, data=None):
                subprocess.run(['openssl', *args], input=data, check=True,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            key, cert = root / 'key.pem', root / 'cert.pem'
            openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', str(key),
                     '-out', str(cert), '-days', '1', '-subj', '/CN=Signing test'])
            for legacy in (False, True):
                with self.subTest(legacy=legacy):
                    archive = root / 'test.p12'
                    openssl(['pkcs12', '-export', '-inkey', str(key), '-in', str(cert),
                             '-out', str(archive), '-passout', 'stdin', *(['-legacy'] if legacy else [])], b'fixture-password\n')
                    self.assertIn(b'BEGIN CERTIFICATE', signing.read_pkcs12(archive, 'fixture-password', ['-clcerts', '-nokeys']))
                    self.assertIn(b'PRIVATE KEY-----', signing.read_pkcs12(archive, 'fixture-password', ['-nocerts', '-nodes']))
                    with self.assertRaisesRegex(RuntimeError, 'password was rejected'):
                        signing.read_pkcs12(archive, 'incorrect-password', ['-clcerts', '-nokeys'])


if __name__ == '__main__':
    unittest.main()
