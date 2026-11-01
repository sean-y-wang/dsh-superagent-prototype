#!/usr/bin/env python3
"""RDG portal ops watchdog: find stalled dsh-superagent tickets (and optional GitLab MR stubs).

Reads `<stateDir>/orchestrator.sqlite` ticket rows (JSON in `value`). Does not modify the DB.
Emits a JSON report on stdout and/or POSTs it to `--hook-url` for a later Feishu adapter.

Offline: `python3 scripts/rdg-portal-watchdog.py --self-test` (exit 0 on success).
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable


def parse_iso(value: str | None) -> datetime | None:
    if not value or not isinstance(value, str):
        return None
    text = value.strip()
    if text.endswith('Z'):
        text = text[:-1] + '+00:00'
    try:
        dt = datetime.fromisoformat(text)
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def ticket_activity_at(ticket: dict[str, Any]) -> datetime | None:
    """Best-effort last activity timestamp from a Ticket JSON blob."""
    candidates: list[datetime] = []
    if ended := ticket.get('ended'):
        if isinstance(ended, dict):
            if dt := parse_iso(ended.get('at')):
                candidates.append(dt)
    for assignment in ticket.get('assignments') or []:
        if not isinstance(assignment, dict):
            continue
        for key in ('idleAt', 'deliveredAt', 'endedAt', 'startedAt', 'createdAt'):
            if dt := parse_iso(assignment.get(key)):
                candidates.append(dt)
        report = assignment.get('report')
        if isinstance(report, dict):
            if dt := parse_iso(report.get('at')):
                candidates.append(dt)
    for item in ticket.get('inputs') or []:
        if isinstance(item, dict):
            if dt := parse_iso(item.get('at')):
                candidates.append(dt)
    return max(candidates) if candidates else None


def is_open(ticket: dict[str, Any]) -> bool:
    return not ticket.get('ended')


@dataclass(frozen=True)
class Finding:
    kind: str  # ticket | gitlab_mr
    id: str
    title: str
    stale_hours: float
    last_activity: str | None
    detail: dict[str, Any]

    def as_dict(self) -> dict[str, Any]:
        return {
            'kind': self.kind,
            'id': self.id,
            'title': self.title,
            'staleHours': round(self.stale_hours, 2),
            'lastActivity': self.last_activity,
            'detail': self.detail,
        }


def scan_tickets(
    tickets: Iterable[dict[str, Any]],
    *,
    now: datetime,
    stale_hours: float,
    state_dir: str | None = None,
) -> list[Finding]:
    threshold_s = stale_hours * 3600
    findings: list[Finding] = []
    for ticket in tickets:
        if not is_open(ticket):
            continue
        last = ticket_activity_at(ticket)
        # Open ticket with no activity markers: treat created mandate time as missing → stalled if we cannot date it.
        ref = last or now
        age_s = (now - ref).total_seconds()
        if last is None or age_s >= threshold_s:
            findings.append(Finding(
                kind='ticket',
                id=str(ticket.get('id') or ''),
                title=str(ticket.get('title') or ticket.get('id') or ''),
                stale_hours=(age_s / 3600.0) if last else stale_hours,
                last_activity=last.isoformat().replace('+00:00', 'Z') if last else None,
                detail={
                    **({'stateDir': state_dir} if state_dir else {}),
                    'attention': ticket.get('attention'),
                    'assignments': len(ticket.get('assignments') or []),
                },
            ))
    return findings


def load_tickets_from_sqlite(db_path: Path) -> list[dict[str, Any]]:
    if not db_path.is_file():
        raise FileNotFoundError(f'orchestrator database not found: {db_path}')
    uri = f'file:{db_path}?mode=ro'
    conn = sqlite3.connect(uri, uri=True)
    try:
        rows = conn.execute('SELECT value FROM ticket').fetchall()
    finally:
        conn.close()
    tickets: list[dict[str, Any]] = []
    for (raw,) in rows:
        try:
            tickets.append(json.loads(raw))
        except json.JSONDecodeError:
            continue
    return tickets


GitlabLister = Callable[[], list[dict[str, Any]]]


def default_gitlab_lister(command: list[str]) -> GitlabLister:
    """Run an external command that prints a JSON array of `{id,title,updatedAt,webUrl?}` MR stubs."""

    def list_mrs() -> list[dict[str, Any]]:
        result = subprocess.run(command, check=False, capture_output=True, text=True)
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or f'gitlab list exited {result.returncode}')
        data = json.loads(result.stdout or '[]')
        if not isinstance(data, list):
            raise RuntimeError('gitlab list command must print a JSON array')
        return [item for item in data if isinstance(item, dict)]

    return list_mrs


def scan_gitlab_mrs(
    mrs: Iterable[dict[str, Any]],
    *,
    now: datetime,
    stale_hours: float,
) -> list[Finding]:
    threshold_s = stale_hours * 3600
    findings: list[Finding] = []
    for mr in mrs:
        last = parse_iso(str(mr.get('updatedAt') or mr.get('updated_at') or ''))
        if last is None:
            continue
        age_s = (now - last).total_seconds()
        if age_s < threshold_s:
            continue
        findings.append(Finding(
            kind='gitlab_mr',
            id=str(mr.get('id') or mr.get('iid') or ''),
            title=str(mr.get('title') or ''),
            stale_hours=age_s / 3600.0,
            last_activity=last.isoformat().replace('+00:00', 'Z'),
            detail={'webUrl': mr.get('webUrl') or mr.get('web_url')},
        ))
    return findings


def build_report(
    *,
    findings: list[Finding],
    now: datetime,
    stale_hours: float,
    state_dirs: list[str],
) -> dict[str, Any]:
    return {
        'ok': True,
        'checkedAt': now.isoformat().replace('+00:00', 'Z'),
        'staleHours': stale_hours,
        'stateDirs': state_dirs,
        'count': len(findings),
        'findings': [f.as_dict() for f in findings],
    }


def post_hook(url: str, report: dict[str, Any], timeout: float = 15.0) -> None:
    body = json.dumps(report, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(
        url, data=body, method='POST',
        headers={'Content-Type': 'application/json; charset=utf-8'},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        resp.read()


def self_test() -> None:
    now = datetime(2026, 11, 1, 12, 0, 0, tzinfo=timezone.utc)
    stale = scan_tickets(
        [
            {
                'id': 't-stale', 'title': 'Old work',
                'assignments': [{'state': 'ended', 'createdAt': '2026-10-01T00:00:00Z',
                                 'report': {'state': 'progress', 'summary': 'x', 'at': '2026-10-01T01:00:00Z'}}],
                'inputs': [],
            },
            {
                'id': 't-fresh', 'title': 'Fresh',
                'assignments': [{'state': 'running', 'createdAt': '2026-11-01T11:00:00Z',
                                 'report': {'state': 'progress', 'summary': 'y', 'at': '2026-11-01T11:30:00Z'}}],
                'inputs': [],
            },
            {
                'id': 't-done', 'title': 'Done', 'ended': {'at': '2026-10-01T00:00:00Z', 'by': 'executor', 'outcome': 'completed'},
                'assignments': [], 'inputs': [],
            },
        ],
        now=now,
        stale_hours=24,
    )
    assert [f.id for f in stale] == ['t-stale'], stale

    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / 'orchestrator.sqlite'
        conn = sqlite3.connect(db)
        conn.execute('CREATE TABLE ticket (id TEXT PRIMARY KEY, value TEXT NOT NULL)')
        conn.execute(
            'INSERT INTO ticket VALUES (?, ?)',
            ('t-stale', json.dumps({
                'id': 't-stale', 'title': 'From DB',
                'assignments': [{'createdAt': '2026-10-20T00:00:00Z',
                                 'report': {'state': 'blocked', 'summary': 'need human', 'at': '2026-10-20T00:00:00Z'}}],
                'inputs': [],
            })),
        )
        conn.commit()
        conn.close()
        loaded = load_tickets_from_sqlite(db)
        found = scan_tickets(loaded, now=now, stale_hours=24, state_dir=tmp)
        assert len(found) == 1 and found[0].title == 'From DB'

    mrs = scan_gitlab_mrs(
        [{'id': '9', 'title': 'Stale MR', 'updatedAt': '2026-10-01T00:00:00Z', 'webUrl': 'https://git.example/mr/9'},
         {'id': '10', 'title': 'Fresh MR', 'updatedAt': '2026-11-01T11:00:00Z'}],
        now=now, stale_hours=24,
    )
    assert [m.id for m in mrs] == ['9']

    report = build_report(findings=stale + mrs, now=now, stale_hours=24, state_dirs=['/tmp/demo'])
    assert report['count'] == 2 and report['ok'] is True
    print(json.dumps({'selfTest': 'passed', 'sample': report}, ensure_ascii=False))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description='Scan dsh-superagent state for stalled tickets / optional GitLab MRs')
    parser.add_argument('--state-dir', action='append', default=[], help='dsh-superagent stateDir (repeatable)')
    parser.add_argument('--stale-hours', type=float, default=24.0, help='Idle threshold in hours (default 24)')
    parser.add_argument('--json', action='store_true', help='Print JSON report (default if no --hook-url)')
    parser.add_argument('--hook-url', default='', help='POST JSON report to this URL (Feishu adapter later)')
    parser.add_argument(
        '--gitlab-list-cmd', default='',
        help='Optional shell command that prints a JSON array of MRs '
             '[{id,title,updatedAt,webUrl}]. Stub in tests; live: wrap glab.',
    )
    parser.add_argument('--self-test', action='store_true', help='Run offline assertions and exit')
    args = parser.parse_args(argv)

    if args.self_test:
        self_test()
        return 0

    if not args.state_dir and not args.gitlab_list_cmd:
        parser.error('provide --state-dir and/or --gitlab-list-cmd (or --self-test)')

    now = datetime.now(timezone.utc)
    findings: list[Finding] = []
    errors: list[str] = []

    for raw in args.state_dir:
        state_dir = str(Path(raw).expanduser().resolve())
        db_path = Path(state_dir) / 'orchestrator.sqlite'
        try:
            tickets = load_tickets_from_sqlite(db_path)
            findings.extend(scan_tickets(tickets, now=now, stale_hours=args.stale_hours, state_dir=state_dir))
        except Exception as error:  # noqa: BLE001 — report per stateDir, continue others
            errors.append(f'{state_dir}: {error}')

    if args.gitlab_list_cmd:
        try:
            lister = default_gitlab_lister(['bash', '-lc', args.gitlab_list_cmd])
            findings.extend(scan_gitlab_mrs(lister(), now=now, stale_hours=args.stale_hours))
        except Exception as error:  # noqa: BLE001
            errors.append(f'gitlab: {error}')

    report = build_report(
        findings=findings, now=now, stale_hours=args.stale_hours, state_dirs=list(args.state_dir),
    )
    if errors:
        report['ok'] = False
        report['errors'] = errors

    if args.hook_url:
        try:
            post_hook(args.hook_url, report)
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            report['ok'] = False
            report.setdefault('errors', []).append(f'hook: {error}')
            print(json.dumps(report, ensure_ascii=False), file=sys.stderr)
            return 1

    if args.json or not args.hook_url:
        print(json.dumps(report, ensure_ascii=False))

    return 0 if report.get('ok') else 2


if __name__ == '__main__':
    sys.exit(main())
