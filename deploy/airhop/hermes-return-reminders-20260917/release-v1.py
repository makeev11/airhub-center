#!/usr/bin/env python3
"""Reviewed one-relay/schema-71 release on center-demo; never roll back the DB automatically."""

import copy
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import time
from urllib.parse import urlsplit, urlunsplit

ROOT = Path('/opt/airhop/hermes-return-reminders-20260917-v1')
PREVIOUS = Path('/opt/airhop/web-push-20260917-v3')
IMAGE = 'airhub-center-relay:hermes-return-reminders-20260917-v1'
BASE_IMAGE = 'airhub-center-relay:web-push-20260917-v3'
BASE_ID = 'sha256:18aa5dc5cb933f92d22d5491649dde204afa6e5c8567ea28b80450115e056229'
COMMIT = 'a51571b81e6f9d3e245f1e05e4ddab23d67d2dfd'
BINARY_SHA = 'b0278b26bfbc2a65c0b5eb7223827ddecab0b2f747368c8c5ad5cb5d775903ef'
GUARD_SHA = '627de9987ede4aea8fd83d3bed36f268d5649f5d3cec622a53003d88bb748601'
REGISTRY_SHA = 'fe20a230e52064e07bc7bf5a595b35f2604689c7483fb1114aaf1bc7aff0cfbc'
DAEMON = 'dbfb14a9-8404-4f21-ad3e-3481b173ea9a'
RELAY = 'buzz-demo-relay-1'
POSTGRES = 'buzz-demo-postgres-1'
PREFLIGHT_DB = 'buzz_hermes_reminder_preflight_a51571b'
PREFLIGHT_CONTAINER = 'airhop-hermes-reminder-preflight-a51571b'


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def run(*args, timeout=120, env=None, input_file=None, output_file=None):
    result = subprocess.run(args, timeout=timeout, env=env, stdin=input_file,
                            stdout=output_file or subprocess.PIPE, stderr=subprocess.PIPE)
    require(result.returncode == 0, f'Command failed: {args[0]} (details suppressed)')
    return result.stdout.decode().strip() if result.stdout is not None else ''


def inspect(name, image=False):
    command = ('docker', 'image', 'inspect') if image else ('docker', 'inspect')
    return json.loads(run(*command, name))[0]


def sha(path, algorithm='sha256'):
    digest = hashlib.new(algorithm)
    with path.open('rb') as stream:
        while chunk := stream.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def record(name, value):
    fd = os.open(ROOT / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as output:
        json.dump(value, output, indent=2, sort_keys=True)
        output.write('\n')


def inventory():
    ids = run('docker', 'ps', '-aq').split()
    result = {}
    for item in json.loads(run('docker', 'inspect', *ids)):
        result[item['Name'].lstrip('/')] = {
            'id': item['Id'], 'image': item['Image'],
            'started': item['State']['StartedAt'], 'status': item['State']['Status'],
            'restarts': item['RestartCount'],
        }
    return result


def host_guard():
    require(socket.gethostname() == 'airhop-prod', 'Wrong deployment host')
    require(run('docker', 'info', '--format', '{{.ID}}') == DAEMON, 'Wrong daemon')
    require(inspect(BASE_IMAGE, image=True)['Id'] == BASE_ID, 'Predecessor tag moved')


def predecessor_guard():
    host_guard()
    live = inspect(RELAY)
    require(live['Image'] == BASE_ID, 'Active relay differs from predecessor')
    require(live['State'].get('Health', {}).get('Status') == 'healthy', 'Predecessor not healthy')
    if ROOT.exists():
        require(inventory() == json.loads((ROOT / 'predecessor.json').read_text()),
                'Container predecessor changed; review required')


def sealed_guard():
    require(sha(ROOT / 'airhop-demo-release.py') == GUARD_SHA, 'Guard hash drift')
    require(sha(ROOT / 'environments.json') == REGISTRY_SHA, 'Registry hash drift')
    inputs = json.loads((ROOT / 'inputs.json').read_text())
    require(all(sha(ROOT / name) == digest for name, digest in inputs.items()), 'Sealed input drift')
    spec = importlib.util.spec_from_file_location('demo_guard', ROOT / 'airhop-demo-release.py')
    guard = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(guard)
    return guard, json.loads((ROOT / 'environments.json').read_text())


def prepare(args):
    predecessor_guard()
    require(not ROOT.exists(), 'Release already exists')
    require(shutil.disk_usage('/opt').free > 2 * 1024**3, 'Insufficient disk headroom')
    require(not run('docker', 'image', 'ls', '--format', '{{.Repository}}:{{.Tag}}', IMAGE),
            'Candidate tag already exists')
    specs = [(Path(args[0]), args[1], 'buzz-relay', 0o555),
             (Path(args[2]), args[3], 'build-receipt.json', 0o600),
             (Path(args[4]), args[5], 'Dockerfile', 0o644),
             (Path(args[6]), args[7], 'rollout.compose.yml', 0o644),
             (Path(args[8]), args[9], '0071.sql', 0o644),
             (Path(__file__), sha(Path(__file__)), 'release.py', 0o555),
             (PREVIOUS / 'airhop-demo-release.py', GUARD_SHA, 'airhop-demo-release.py', 0o555),
             (PREVIOUS / 'environments.json', REGISTRY_SHA, 'environments.json', 0o644)]
    require(all(source.is_file() and sha(source) == digest for source, digest, _, _ in specs),
            'Release input hash mismatch')
    receipt = json.loads(Path(args[2]).read_text())
    require(receipt['commit'] == COMMIT and receipt['binary_sha256'] == BINARY_SHA,
            'Build receipt identity mismatch')
    require(args[1] == BINARY_SHA, 'Unexpected candidate binary')
    before = inventory()
    ROOT.mkdir(mode=0o700)
    record('predecessor.json', before)
    inputs = {}
    for source, digest, name, mode in specs:
        destination = ROOT / name
        with destination.open('xb') as output:
            output.write(source.read_bytes())
        os.chmod(destination, mode)
        inputs[name] = digest
    record('inputs.json', inputs)
    record('prepare-receipt.json', {'commit': COMMIT, 'prepared_at': time.time()})
    predecessor_guard()


def build():
    predecessor_guard()
    sealed_guard()
    require(not (ROOT / 'package-receipt.json').exists(), 'Package already built')
    with (ROOT / 'package.log').open('xb') as log:
        run('docker', 'build', '--network', 'none', '--pull=false', '--no-cache',
            '-f', str(ROOT / 'Dockerfile'), '-t', IMAGE, str(ROOT), timeout=600, output_file=log)
    candidate = inspect(IMAGE, image=True)
    base = inspect(BASE_IMAGE, image=True)
    require(candidate['Architecture'] == 'amd64', 'Candidate architecture mismatch')
    for key in ('User', 'Entrypoint', 'Cmd', 'WorkingDir'):
        require(candidate['Config'].get(key) == base['Config'].get(key), 'Runtime identity mismatch')
    require((candidate['Config'].get('Labels') or {}).get('org.opencontainers.image.revision') == COMMIT,
            'Candidate revision mismatch')
    binary_sha = run('docker', 'run', '--rm', '--network', 'none', '--read-only',
                     '--entrypoint', 'sha256sum', IMAGE, '/usr/local/bin/buzz-relay').split()[0]
    require(binary_sha == BINARY_SHA, 'Packaged binary differs')
    predecessor_guard()
    record('package-receipt.json', {'image': IMAGE, 'image_id': candidate['Id'],
           'base_image_id': BASE_ID, 'binary_sha256': binary_sha, 'commit': COMMIT,
           'completed_at': time.time()})


def db_identity():
    container = inspect(POSTGRES)
    require(container['Config']['Labels']['com.docker.compose.project'] == 'buzz-demo',
            'Postgres belongs to another project')
    require(any(mount.get('Name') == 'buzz-demo-postgres-data' for mount in container['Mounts']),
            'Postgres volume differs')
    values = dict(entry.split('=', 1) for entry in container['Config']['Env'] if '=' in entry)
    user, database = values['POSTGRES_USER'], values['POSTGRES_DB']
    require(re.fullmatch(r'[a-zA-Z_][a-zA-Z0-9_]*', user) and
            re.fullmatch(r'[a-zA-Z_][a-zA-Z0-9_]*', database), 'Unexpected DB identifier')
    return user, database


def psql(database, query):
    user, _ = db_identity()
    return run('docker', 'exec', POSTGRES, 'psql', '-X', '-v', 'ON_ERROR_STOP=1',
               '-U', user, '-d', database, '-Atc', query)


def schema71(database):
    checksum = sha(ROOT / '0071.sql', 'sha384')
    require(psql(database, "SELECT version || '|' || success || '|' || encode(checksum,'hex') "
                 "FROM _sqlx_migrations ORDER BY version DESC LIMIT 1") == '71|true|' + checksum,
            'Schema-71 migration receipt/checksum mismatch')
    require(psql(database, "SELECT to_regclass('airhop_human_takeover_reminders') IS NOT NULL") == 't',
            'Reminder table missing')
    require(psql(database, "SELECT count(*) FROM information_schema.columns WHERE "
                 "table_name='airhop_external_conversations' AND column_name='human_staff_outbound_count' "
                 "AND is_nullable='NO' AND data_type='bigint'") == '1', 'Counter shape differs')


def backup_and_preflight():
    user, database = db_identity()
    require(psql(database, 'SELECT max(version), count(*) FILTER (WHERE NOT success) FROM _sqlx_migrations')
            == '70|0', 'Live schema differs from reviewed version 70')
    require(psql('postgres', "SELECT count(*) FROM pg_database WHERE datname='" + PREFLIGHT_DB + "'") == '0',
            'Preflight database already exists')
    require(not run('docker', 'ps', '-aq', '--filter', 'name=^/' + PREFLIGHT_CONTAINER + '$'),
            'Preflight container already exists')
    backup = ROOT / 'backup'
    backup.mkdir(mode=0o700)
    dump = backup / 'buzz.dump'
    fd = os.open(dump, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'wb') as output:
        run('docker', 'exec', POSTGRES, 'pg_dump', '-U', user, '-d', database,
            '-Fc', timeout=600, output_file=output)
    require(dump.stat().st_size > 1000, 'Backup is unexpectedly empty')
    record('backup-receipt.json', {'path': str(dump), 'sha256': sha(dump),
           'size': dump.stat().st_size, 'schema': 70, 'created_at': time.time()})
    psql('postgres', f'CREATE DATABASE {PREFLIGHT_DB} OWNER {user}')
    psql('postgres', f'REVOKE CONNECT ON DATABASE {PREFLIGHT_DB} FROM PUBLIC')
    container_created = False
    preflight_passed = False
    try:
        with dump.open('rb') as input_stream:
            run('docker', 'exec', '-i', POSTGRES, 'pg_restore', '-U', user, '-d', PREFLIGHT_DB,
                '--exit-on-error', timeout=600, input_file=input_stream)
        values = dict(entry.split('=', 1) for entry in inspect(RELAY)['Config']['Env'] if '=' in entry)
        url = urlsplit(values['DATABASE_URL'])
        require(url.path == '/' + database, 'Relay and Postgres database identity differs')
        credentials = url.netloc.rsplit('@', 1)[0]
        preflight_url = urlunsplit((url.scheme, credentials + '@127.0.0.1:5432', '/' + PREFLIGHT_DB, url.query, ''))
        # No live Redis or secret mounts; startup necessarily stops before any
        # provider/background worker. Only the restored database is reachable.
        environment = {**os.environ, 'DATABASE_URL': preflight_url}
        run('docker', 'run', '-d', '--name', PREFLIGHT_CONTAINER,
            '--network', 'container:' + POSTGRES, '--read-only', '--tmpfs', '/tmp',
            '--memory', '512m', '--memory-swap', '512m', '--cpus', '1', '--pids-limit', '128',
            '-e', 'DATABASE_URL', '-e', 'BUZZ_AUTO_MIGRATE=true',
            '-e', 'REDIS_URL=redis://127.0.0.1:1',
            '-e', 'RELAY_URL=wss://hermes-reminder-preflight.invalid',
            '-e', 'BUZZ_BIND_ADDR=127.0.0.1:19900',
            '-e', 'BUZZ_HEALTH_PORT=19930', '-e', 'BUZZ_METRICS_PORT=19931',
            '-e', 'BUZZ_AUDIT_ENABLED=false', '-e', 'BUZZ_REQUIRE_RELAY_MEMBERSHIP=false',
            IMAGE, env=environment)
        container_created = True
        for _ in range(60):
            logs = run('docker', 'logs', PREFLIGHT_CONTAINER)
            if 'Database migrations complete' in logs:
                preflight_passed = True
                break
            if not inspect(PREFLIGHT_CONTAINER)['State']['Running']:
                break
            time.sleep(1)
        require(preflight_passed, 'Candidate migration preflight failed (logs not exported)')
        schema71(PREFLIGHT_DB)
        require(psql(PREFLIGHT_DB, 'SELECT count(*) FROM airhop_human_takeover_reminders') == '0',
                'Unexpected reminder preflight rows')
        record('migration-preflight-receipt.json', {'backup_restored': True, 'schema': 71,
               'migration_checksum_sha384': sha(ROOT / '0071.sql', 'sha384'),
               'candidate_binary_sha256': BINARY_SHA, 'no_live_redis_or_provider': True,
               'completed_at': time.time()})
    finally:
        if container_created:
            run('docker', 'rm', '-f', PREFLIGHT_CONTAINER)
        psql('postgres', f'DROP DATABASE {PREFLIGHT_DB} WITH (FORCE)')


def rollback(guard, registry, expected):
    # Migration 71 is additive. Do not drop new data/table/counter automatically.
    # Old embedded migrator lacks version 71, so disable auto-migrate only on
    # the reviewed image rollback while preserving the full predecessor chain.
    target = registry['targets']['center-demo']
    overlay = ROOT / 'rollback-no-auto-migrate.compose.yml'
    with overlay.open('x') as output:
        output.write('services:\n  relay:\n    environment:\n      BUZZ_AUTO_MIGRATE: "false"\n')
    args = guard.compose_args(target, expected['compose_files'])
    before = json.loads(guard.command(*args, 'config', '--format', 'json'))
    args = guard.compose_args(target, expected['compose_files'] + [str(overlay)])
    after = json.loads(guard.command(*args, 'config', '--format', 'json'))
    normalized = copy.deepcopy(after)
    normalized['services']['relay']['environment']['BUZZ_AUTO_MIGRATE'] = before['services']['relay']['environment']['BUZZ_AUTO_MIGRATE']
    require(normalized == before, 'Rollback changes more than migration switch')
    guard.validate_config(after, target)
    guard.check_legacy_boundary(registry)
    guard.command(*args, 'up', '-d', '--no-deps', '--no-build', '--pull', 'never',
                  '--wait', '--wait-timeout', '180', 'relay')
    restored = inspect(RELAY)
    require(restored['Image'] == BASE_ID and restored['State']['Health']['Status'] == 'healthy',
            'Rollback did not restore healthy predecessor')
    require(guard.protected_containers(target) == expected['protected'], 'Protected container changed')
    record('rollback-receipt.json', {'image_id': BASE_ID, 'database_not_rolled_back': True,
           'auto_migrate_disabled': True, 'completed_at': time.time()})


def apply():
    predecessor_guard()
    guard, registry = sealed_guard()
    expected = json.loads((ROOT / 'plan.json').read_text())
    require(guard.make_plan(registry, str(ROOT / 'rollout.compose.yml')) == expected,
            'Plan is stale; review required')
    values = dict(entry.split('=', 1) for entry in inspect(RELAY)['Config']['Env'] if '=' in entry)
    require(values.get('BUZZ_AUTO_MIGRATE') == 'true', 'Live auto-migrate differs')
    backup_and_preflight()
    # Repeat the whole guard after backup/restore and under the same held lock.
    require(guard.make_plan(registry, str(ROOT / 'rollout.compose.yml')) == expected,
            'Predecessor changed during migration preflight')
    target = registry['targets']['center-demo']
    args = guard.compose_args(target, expected['compose_files'] + [expected['release_file']])
    try:
        guard.command(*args, 'up', '-d', '--no-deps', '--no-build', '--pull', 'never',
                      '--wait', '--wait-timeout', '180', 'relay')
        deployed = inspect(RELAY)
        require(deployed['Image'] == expected['next_image_id'], 'Deployed image differs')
        require(deployed['State']['Health']['Status'] == 'healthy', 'Deployed relay not healthy')
        user, database = db_identity()
        schema71(database)
        configured = json.loads(guard.command(*args, 'config', '--format', 'json'))
        guard.validate_live(configured, deployed, target)
        require(guard.protected_containers(target) == expected['protected'], 'Protected container changed')
    except Exception:
        record('apply-failure.json', {'database_not_rolled_back': True, 'failed_at': time.time()})
        rollback(guard, registry, expected)
        raise RuntimeError('Release failed; healthy predecessor image restored with additive schema preserved')
    record('apply-receipt.json', {'target': 'center-demo', 'commit': COMMIT, 'image': IMAGE,
           'image_id': deployed['Image'], 'container_id': deployed['Id'], 'schema': 71,
           'health': 'healthy', 'protected_containers_unchanged': len(expected['protected']),
           'compose_files_count': len(expected['compose_files']) + 1, 'completed_at': time.time()})


def main():
    os.umask(0o077)
    with open('/opt/airhop/buzz-demo/deploy.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        host_guard()
        action = sys.argv[1]
        if action == 'prepare':
            prepare(sys.argv[2:])
        elif action == 'build':
            build()
        elif action == 'plan':
            predecessor_guard()
            guard, registry = sealed_guard()
            record('plan.json', guard.make_plan(registry, str(ROOT / 'rollout.compose.yml')))
        elif action == 'apply':
            apply()
        else:
            raise RuntimeError('Unknown action')
        print('Completed', action, '; target center-demo')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Release stopped:', str(error) if isinstance(error, RuntimeError) else type(error).__name__, file=sys.stderr)
        sys.exit(1)
