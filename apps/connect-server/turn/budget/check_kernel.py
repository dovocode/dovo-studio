"""Run the real nftables guard in a disposable user/network namespace only."""
import os
from pathlib import Path
import socket
import subprocess
import sys


def check():
    import guard
    subprocess.run(['ip', 'link', 'set', 'lo', 'up'], check=True)
    guard.install(4096, 5349)
    local_relay = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    local_relay.bind(('127.0.0.1', 20000))
    other_relay = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    other_relay.bind(('127.0.0.1', 20001))
    other_relay.settimeout(0.15)
    local_relay.sendto(b'allowed-relay-to-relay', other_relay.getsockname())
    assert other_relay.recv(2048) == b'allowed-relay-to-relay'
    service = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    service.bind(('127.0.0.1', 0))
    service.settimeout(0.15)
    try:
        local_relay.sendto(b'blocked-host-service', service.getsockname())
    except PermissionError:
        pass
    try:
        service.recv(2048)
        raise AssertionError('Relay reached another service on its own host')
    except TimeoutError:
        pass
    local_relay.close()
    other_relay.close()
    service.close()
    guard.install(4096, 5349)
    receiver = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    receiver.bind(('127.0.0.1', 0))
    receiver.settimeout(0.15)
    sender = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sender.bind(('127.0.0.1', 3478))
    destination = receiver.getsockname()
    for _ in range(32):
        try:
            sender.sendto(b'x' * 256, destination)
        except PermissionError:
            pass  # Local OUTPUT drops report EPERM to the sender.
    packets = []
    try:
        while True:
            packets.append(receiver.recv(2048))
    except TimeoutError:
        pass
    assert packets and sum(map(len, packets)) <= 4096, len(packets)
    assert guard.consumed() >= 4096
    # Exhaustion also stops an already open socket; another service is unaffected.
    try:
        sender.sendto(b'blocked', destination)
    except PermissionError:
        pass
    try:
        receiver.recv(2048)
        raise AssertionError('Established relay socket escaped the cap')
    except TimeoutError:
        pass
    other = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    other.sendto(b'unrelated', destination)
    assert receiver.recv(2048) == b'unrelated'
    # Atomic refill resumes the same connection, and the zero allowance blocks it.
    guard.install(1024, 5349)
    sender.sendto(b'resumed', destination)
    assert receiver.recv(2048) == b'resumed'
    guard.install(0, 5349)
    try:
        sender.sendto(b'blocked', destination)
    except PermissionError:
        pass
    try:
        receiver.recv(2048)
        raise AssertionError('Zero allowance allowed traffic')
    except TimeoutError:
        pass
    print('Real nftables checks passed: byte cap, established sockets, atomic refill, zero allowance and unrelated service isolation.')


if __name__ == '__main__':
    if len(sys.argv) == 3 and sys.argv[1] == '--isolated':
        if str(os.stat('/proc/self/ns/net').st_ino) == sys.argv[2]:
            raise RuntimeError('Refusing to test in the original network namespace')
        check()
    else:
        subprocess.run(['unshare', '--user', '--map-root-user', '--net', sys.executable,
                        str(Path(__file__).resolve()), '--isolated',
                        str(os.stat('/proc/self/ns/net').st_ino)], check=True)
