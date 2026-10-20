"""Operator-side hard egress quota for coturn. No application payload inspection.

Reserve bytes durably BEFORE authorizing the kernel to pass them. Restarts may
waste the unused part of one reservation, never reset the day's allowance.
The nftables rules remain fail-closed if this process exits.
"""
import datetime
import fcntl
import json
import ipaddress
import os
from pathlib import Path
import subprocess
import time

LIMIT = 750_000_000_000  # decimal GB, UTC calendar day
CHUNK = 1_000_000_000
TABLE = 'dovo_turn_budget'
BOOT_ID = Path('/proc/sys/kernel/random/boot_id')


def readiness(tls_port):
    # Persistent volume markers alone cannot establish that this boot has rules.
    # Keep the raw public-IP configuration identical to coturn's shell readiness check.
    return f'{BOOT_ID.read_text().strip()}:{tls_port}:security-v5-daily:{os.environ.get("DOVO_TURN_PUBLIC_IPS", "")}'


def publish_ready(directory, tls_port):
    temporary = directory / 'ready.next'
    temporary.unlink(missing_ok=True)  # A crash can leave the read-only temporary file.
    temporary.write_text(readiness(tls_port))
    temporary.chmod(0o444)
    os.replace(temporary, directory / 'ready')


def day():
    return datetime.datetime.now(datetime.timezone.utc).date().isoformat()


def rules(allowance, tls_port):
    if not 0 <= allowance <= LIMIT:
        raise ValueError('Invalid allowance')
    if not 1 <= tls_port <= 65535 or tls_port == 3478 or 20000 <= tls_port <= 20099:
        raise ValueError('Invalid TURN TLS port')
    # A peer may share this TURN server: preserve relay-to-relay ports, while preventing
    # allocations from reaching SSH/ingress/other services on our own host. NAT public
    # addresses are not FIB-local, so operators must list those explicitly.
    destinations = []
    for value in os.environ.get('DOVO_TURN_PUBLIC_IPS', '').split(','):
        if not value.strip():
            continue
        address = ipaddress.ip_address(value.strip())
        if getattr(address, 'scope_id', None) is not None:
            raise ValueError('TURN public IPs cannot contain IPv6 zone identifiers')
        family = 'ip' if address.version == 4 else 'ip6'
        destinations.append(f'udp sport 20000-20099 {family} daddr {address} udp dport != 20000-20099 drop')
    self_rules = '\n   '.join(destinations)
    return f'''table inet {TABLE} {{
 quota egress {{ until {allowance} bytes; }}
 chain relay {{ quota name "egress" return; drop; }}
 chain output {{ type filter hook output priority -10; policy accept;
   udp sport 20000-20099 fib daddr type local udp dport != 20000-20099 drop
   {self_rules}
   udp sport {{ 3478, {tls_port}, 20000-20099 }} jump relay
   tcp sport {{ 3478, {tls_port} }} jump relay
 }}
}}'''


def nft(*args, script=None):
    return subprocess.run(['nft', *args], input=script, text=True, capture_output=True, check=True).stdout


def install(allowance, tls_port):
    # One atomic transaction: no gap where established flows can escape the cap.
    existing = json.loads(nft('-j', 'list', 'tables'))
    exists = any(item.get('table', {}).get('family') == 'inet' and
                 item.get('table', {}).get('name') == TABLE for item in existing['nftables'])
    prefix = f'delete table inet {TABLE}\n' if exists else ''
    nft('-f', '-', script=prefix + rules(allowance, tls_port))


def consumed():
    result = json.loads(nft('-j', 'list', 'quota', 'inet', TABLE, 'egress'))
    quotas = [item['quota'] for item in result['nftables'] if 'quota' in item]
    if len(quotas) != 1:
        raise ValueError('Missing kernel quota')
    value = quotas[0].get('used', 0)
    if type(value) is not int or value < 0:
        raise ValueError('Invalid kernel byte count')
    return value


class Ledger:
    def __init__(self, directory):
        self.directory = Path(directory)
        self.path = self.directory / 'state.json'
        self.directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        # Coturn mounts this volume read-only and may run as an unprivileged UID.
        # It can read the nonsecret readiness marker, but not the private ledger.
        self.directory.chmod(0o711)
        # Prevent two guardians from handing out the same reserved budget.
        self.lock = open(self.directory / 'lock', 'a')
        try:
            fcntl.flock(self.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except Exception:
            self.lock.close()
            raise

    def reserve(self, current):
        if datetime.date.fromisoformat(current).isoformat() != current:
            raise ValueError('Invalid budget day')
        if self.path.exists():
            state = json.loads(self.path.read_text())
            reserved = state['reserved']
            if 'day' in state:
                saved = state['day']
                if datetime.date.fromisoformat(saved).isoformat() != saved:
                    raise ValueError('Invalid saved budget day')
                period = current
            else:
                # Migrate the old monthly ledger without discarding charged bytes.
                # Charge the entire current month's reservation to today's daily cap.
                saved = state['month']
                if datetime.datetime.strptime(saved, '%Y-%m').strftime('%Y-%m') != saved:
                    raise ValueError('Invalid saved budget month')
                period = current[:7]
            if type(reserved) is not int or not 0 <= reserved <= LIMIT or saved > period:
                raise ValueError('Invalid or future budget state')
            if saved < period:
                # The previous kernel reservation may pass bytes just after midnight
                # before this process runs. Charge that entire chunk to the new day.
                reserved = CHUNK
        else:
            reserved = 0
        grant = min(CHUNK, LIMIT - reserved)
        value = {'day': current, 'reserved': reserved + grant}
        temporary = self.directory / 'state.next'
        with open(temporary, 'w') as stream:
            os.chmod(temporary, 0o600)
            json.dump(value, stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, self.path)
        descriptor = os.open(self.directory, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        return grant


def main():
    directory = Path(os.environ.get('DOVO_TURN_BUDGET_DIR', '/budget'))
    ready = directory / 'ready'
    ready.unlink(missing_ok=True)
    tls_port = int(os.environ.get('DOVO_TURN_TLS_PORT', '443'))
    # Block traffic before touching disk. Invalid/missing permissions cannot start coturn.
    install(0, tls_port)
    ledger = Ledger(directory)
    current = day()
    allowance = ledger.reserve(current)
    install(allowance, tls_port)
    publish_ready(directory, tls_port)
    print('Dovo TURN hard egress budget active: 750 GB/UTC day', flush=True)
    while True:
        time.sleep(1)
        next_day = day()
        if next_day < current:
            raise ValueError('Clock moved before current budget day')
        if next_day != current or (allowance and consumed() >= allowance):
            # Close the old day FIRST, then reserve and authorize a new chunk.
            install(0, tls_port)
            allowance = ledger.reserve(next_day)
            current = next_day
            install(allowance, tls_port)
            if not allowance:
                print('Dovo TURN daily budget exhausted; relay traffic is blocked', flush=True)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # The final authorized reservation is already charged to disk. Existing rules
        # keep enforcing it even if the watcher fails; the healthcheck prevents startup.
        Path(os.environ.get('DOVO_TURN_BUDGET_DIR', '/budget'), 'ready').unlink(missing_ok=True)
        raise
