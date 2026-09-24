#!/usr/bin/env python3
"""Upload Mac release credentials directly to GitHub Secrets, without writing passwords to disk."""
import base64
import getpass
import pathlib
import subprocess
import sys

REPOSITORY = 'dovocode/dovo-studio'
IDENTITY = 'Developer ID Application: Dovocode (VDXV4YX2UK)'
TEAM = 'VDXV4YX2UK'


def run(args, data=None):
    result = subprocess.run(args, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        # Don't echo commands, supplied passwords, or arbitrary subprocess output.
        raise RuntimeError(f'{args[0]} failed. Check credentials and access, then retry.')
    return result.stdout


def read_pkcs12(path, password, options):
    args = ['openssl', 'pkcs12', '-in', str(path), '-passin', 'stdin', *options]
    result = subprocess.run(args, input=(password + '\n').encode(),
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    # Keychain exports can use RC2; load that provider only for this read operation.
    if result.returncode and (b'unsupported' in result.stderr.lower() or b'RC2' in result.stderr):
        result = subprocess.run([*args, '-legacy'], input=(password + '\n').encode(),
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        error = result.stderr.lower()
        if b'mac verify error' in error or b'mac verify failure' in error or b'invalid password' in error:
            raise RuntimeError('The .p12 export password was rejected (or the file is damaged). Use the password chosen when exporting from Keychain.')
        if b'unsupported' in error or b'provider' in error:
            raise RuntimeError('OpenSSL cannot load the legacy cipher provider. Use a complete OpenSSL 3 installation, such as Homebrew openssl@3.')
        raise RuntimeError('Could not read the .p12 export. Export the Developer ID identity again, including its private key.')
    return result.stdout


def main():
    if not sys.stdin.isatty():
        raise RuntimeError('Run this helper interactively in Terminal.')
    run(['gh', 'repo', 'view', REPOSITORY, '--json', 'nameWithOwner'])
    print(f'Configuring Mac signing secrets for {REPOSITORY}.')
    path = pathlib.Path(input('Exported Developer ID .p12 path: ').strip()).expanduser()
    if not path.is_file():
        raise RuntimeError('The certificate file does not exist.')
    password = getpass.getpass('Certificate export password: ')
    if not password:
        raise RuntimeError('Use a password-protected certificate export.')
    certificate = read_pkcs12(path, password, ['-clcerts', '-nokeys'])
    subject = run(['openssl', 'x509', '-noout', '-subject', '-nameopt', 'RFC2253'], certificate).decode()
    if f'CN={IDENTITY}' not in subject or f'OU={TEAM}' not in subject:
        raise RuntimeError('Export only the Dovocode Developer ID Application identity, including its private key.')
    run(['openssl', 'x509', '-checkend', '86400', '-noout'], certificate)
    # Confirm that this is an identity export, not a public certificate alone.
    keys = read_pkcs12(path, password, ['-nocerts', '-nodes'])
    if b'PRIVATE KEY-----' not in keys:
        raise RuntimeError('The export does not contain a private key.')
    del keys
    apple_id = input('Apple account email for notarization: ').strip()
    apple_password = getpass.getpass('Apple app-specific password (not your account password): ').strip()
    if '@' not in apple_id or not apple_password:
        raise RuntimeError('Both Apple account email and app-specific password are required.')
    secrets = {
        'MAC_CERTIFICATE': base64.b64encode(path.read_bytes()),
        'MAC_CERTIFICATE_PASSWORD': password.encode(),
        'MAC_SIGNING_IDENTITY': IDENTITY.encode(),
        'APPLE_ID': apple_id.encode(),
        'APPLE_APP_SPECIFIC_PASSWORD': apple_password.encode(),
        'APPLE_TEAM_ID': TEAM.encode(),
    }
    for name, value in secrets.items():
        run(['gh', 'secret', 'set', name, '--repo', REPOSITORY], value)
        print(f'Configured {name}')
    print('All six secrets uploaded. Run the Release workflow to verify signing and notarization.')
    print('The .p12 export remains at your chosen path; keep it secure or remove it when no longer needed.')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, KeyboardInterrupt, EOFError) as error:
        print(str(error) or 'Cancelled.', file=sys.stderr)
        sys.exit(1)
