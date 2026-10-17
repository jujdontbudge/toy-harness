"""Locked credential-pool administration and target resolution."""
from __future__ import annotations

import time
from dataclasses import replace
from typing import Any, Optional, Tuple, TYPE_CHECKING

if TYPE_CHECKING:
    from agent.credential_pool import PooledCredential


def _cleared_status_copy(entry: PooledCredential) -> PooledCredential:
    from agent.credential_pool import _CLEAR_STATUS

    # The reset marker lets a live pool in another process tell "reset after my cooldown" from
    # "never had a status" — both read as bare None on disk (#89415).
    return replace(entry, **_CLEAR_STATUS, model_cooldowns=None, status_cleared_at=time.time(),
                   extra={k: v for k, v in entry.extra.items() if k != "failure_reason"})


class CredentialPoolAdminMixin:
    def reset_status(self, credential_id: str) -> Optional[PooledCredential]:
        """Clear only the target's local error state, preserving sibling cooldowns."""
        with self._lock:
            entry = self._find(lambda e: e.id == credential_id)
            if entry is None:
                return None
            cleared = _cleared_status_copy(entry)
            self._replace_entry(entry, cleared)
            self._persist(status_cleared_ids=[cleared.id])
            return cleared
    def reset_statuses(self) -> int:
        """Clear exhaustion state on every entry. Returns how many were cleared.

        ``failure_reason`` lives in ``extra``, not a dataclass field, so it is
        stripped explicitly. The persist declares the cleared ids because the
        disk-recency merge reads a cleared ``last_status_at`` (None -> epoch 0)
        as a stale snapshot and would copy a still-binding cooldown back.
        """
        from agent.credential_pool import _CLEAR_STATUS

        with self._lock:
            stale = [
                e for e in self._entries
                if e.last_status or e.last_status_at or e.last_error_code or e.failure_reason or e.model_cooldowns
            ]
            if stale:
                stale_ids = {e.id for e in stale}
                self._entries = [
                    _cleared_status_copy(e) if e.id in stale_ids else e
                    for e in self._entries
                ]
                self._persist(status_cleared_ids=list(stale_ids))
            return len(stale)

    def remove_index(self, index: int) -> Optional[PooledCredential]:
        with self._lock:
            if index < 1 or index > len(self._entries):
                return None
            removed = self._entries.pop(index - 1)
            self._entries = [replace(e, priority=p) for p, e in enumerate(self._entries)]
            self._persist(removed_ids=[removed.id])
            if self._current_id == removed.id:
                self._current_id = None
            return removed

    def move_entry(self, credential_id: str, priority: int) -> Optional[PooledCredential]:
        """Place an entry at a clamped zero-based position and persist contiguous priorities."""
        from agent.credential_pool import _normalize_pool_priorities

        with self._lock:
            entry = self._find(lambda e: e.id == credential_id)
            if entry is None:
                return None
            others = [e for e in self._entries if e.id != credential_id]
            others.insert(max(0, min(int(priority), len(others))), entry)
            entries = [replace(e, priority=p) for p, e in enumerate(others)]
            # Apply load-time ordering now so the reported position survives reload.
            _normalize_pool_priorities(self.provider, entries)
            self._entries = sorted(entries, key=lambda e: e.priority)
            self._persist()
            return self._find(lambda e: e.id == credential_id)

    def resolve_target(self, target: Any) -> Tuple[Optional[int], Optional[PooledCredential], Optional[str]]:
        raw = str(target or "").strip()
        if not raw:
            return None, None, "No credential target provided."

        with self._lock:
            for idx, entry in enumerate(self._entries, start=1):
                if entry.id == raw:
                    return idx, entry, None

            label_matches = [
                (idx, entry)
                for idx, entry in enumerate(self._entries, start=1)
                if entry.label.strip().lower() == raw.lower()
            ]
            if len(label_matches) == 1:
                return label_matches[0][0], label_matches[0][1], None
            if len(label_matches) > 1:
                return None, None, f'Ambiguous credential label "{raw}". Use the numeric index or entry id instead.'
            if raw.isdigit():
                index = int(raw)
                if 1 <= index <= len(self._entries):
                    return index, self._entries[index - 1], None
                return None, None, f"No credential #{index}."
            return None, None, f'No credential matching "{raw}".'

    def add_entry(self, entry: PooledCredential) -> PooledCredential:
        from agent.credential_pool import (
            PooledCredential,
            _next_priority,
            claim_profile_pool_on_add,
            require_added_credential,
            write_credential_pool,
        )
        from hermes_cli import auth as auth_mod

        with self._lock:
            previous_entries = list(self._entries)
            previous_pairs = dict(self._persisted_token_pairs)
            previous_borrowed = set(
                getattr(self, "_borrowed_root_ids", set()) or set()
            )

            claims_profile = claim_profile_pool_on_add(
                self.provider, previous_borrowed
            )

            if claims_profile:
                # Use only active-store rows. The in-memory pool may contain
                # root rows or singleton seeds that must not be copied.
                store = auth_mod._load_auth_store()
                active_pool = store.get("credential_pool")
                payloads = (
                    active_pool.get(self.provider)
                    if isinstance(active_pool, dict) else None
                )
                payloads = payloads if isinstance(payloads, list) else []
                active_entries = [
                    PooledCredential.from_dict(self.provider, payload)
                    for payload in payloads
                    if isinstance(payload, dict)
                ]
                entry = replace(
                    entry, priority=_next_priority(active_entries)
                )
                candidate_entries = active_entries + [entry]
            else:
                entry = replace(
                    entry, priority=_next_priority(previous_entries)
                )
                candidate_entries = previous_entries + [entry]

            try:
                if claims_profile:
                    written = write_credential_pool(
                        self.provider,
                        [e.to_dict() for e in candidate_entries],
                        token_bases=previous_pairs,
                    )
                    self._entries = [
                        PooledCredential.from_dict(self.provider, payload)
                        for payload in written
                        if isinstance(payload, dict)
                    ]
                    self._persisted_token_pairs = (
                        auth_mod._token_pairs_by_id(written)
                    )
                else:
                    self._entries = candidate_entries
                    self._persist()

                saved = require_added_credential(self.provider, entry.id)
            except Exception:
                # Disk effects may be uncertain; do not print success or
                # automatically repeat OAuth. Restore only in-memory state.
                self._entries = previous_entries
                self._persisted_token_pairs = previous_pairs
                self._borrowed_root_ids = previous_borrowed
                raise

            self._borrowed_root_ids = set()
            return PooledCredential.from_dict(self.provider, saved)
