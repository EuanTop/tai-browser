"""Resolve only whole-repository GitHub mirrors; preserve pinned Git identities."""
import configparser
from pathlib import Path
import re

GITHUB_MIRROR = re.compile(
    r'^https://chromium\.googlesource\.com/external/github\.com/'
    r'([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+?)(?:\.git)?$')


def github_origin(url):
    match = GITHUB_MIRROR.fullmatch(url)
    if not match:
        return None
    owner, repository = match.groups()
    return f'https://github.com/{owner}/{repository}'


def transport_aliases(source: Path, repository: str):
    # The Chromium server also hosts distinct repositories below /chromium/src/.
    # Include the Git suffix so the root rewrite cannot capture those URLs.
    aliases = {repository.removesuffix('.git') + '.git': 'https://github.com/chromium/chromium',
               'https://chromium.googlesource.com/angle/angle': 'https://github.com/google/angle',
               'https://skia.googlesource.com/skia': 'https://github.com/google/skia',
               'https://swiftshader.googlesource.com/SwiftShader': 'https://github.com/google/swiftshader'}
    modules = source / '.gitmodules'
    if modules.is_file():
        config = configparser.ConfigParser(interpolation=None)
        config.read(modules)
        urls = [config[section].get('url', '') for section in config.sections()]
        for url in urls:
            target = github_origin(url)
            base = url.removesuffix('.git')
            # Git insteadOf is prefix-based. A whole llvm-project rule would
            # otherwise also capture its filtered sub-repositories.
            has_nested_repository = any(other.startswith(base + '/') for other in urls)
            if target and not has_nested_repository:
                aliases[url.removesuffix('.git')] = target
    return aliases
