from __future__ import annotations

import asyncio
import ipaddress
import socket
from urllib.parse import urlsplit


class UnsafeUrl(ValueError):
    pass


def host_matches(hostname: str, allowed_hosts: tuple[str, ...]) -> bool:
    host = hostname.lower().rstrip(".")
    return any(host == allowed or host.endswith(f".{allowed}") for allowed in allowed_hosts)


async def validate_public_url(value: str, allowed_hosts: tuple[str, ...] | None = None) -> str:
    parsed = urlsplit(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise UnsafeUrl("Only complete HTTP or HTTPS URLs are allowed")
    if parsed.username or parsed.password:
        raise UnsafeUrl("Credentials in URLs are not allowed")
    if parsed.port and parsed.port not in {80, 443}:
        raise UnsafeUrl("Only standard web ports are allowed")
    hostname = parsed.hostname.lower().rstrip(".")
    if allowed_hosts is not None and not host_matches(hostname, allowed_hosts):
        raise UnsafeUrl("Media host is not in TEAMWORK_MEDIA_HOSTS")

    try:
        addresses = await asyncio.to_thread(
            socket.getaddrinfo,
            hostname,
            parsed.port or (443 if parsed.scheme == "https" else 80),
            type=socket.SOCK_STREAM,
        )
    except socket.gaierror as error:
        raise UnsafeUrl("Host could not be resolved") from error
    if not addresses:
        raise UnsafeUrl("Host could not be resolved")
    for address in addresses:
        ip = ipaddress.ip_address(address[4][0])
        if not ip.is_global:
            raise UnsafeUrl("Private, loopback, link-local and reserved addresses are blocked")
    return value
