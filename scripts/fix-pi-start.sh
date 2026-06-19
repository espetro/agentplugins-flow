#!/usr/bin/env bash
# fix-pi-start.sh — Idempotent: kill pi, backup & fix settings, restart with logging.
# Run from a plain terminal (not inside pi).
set -euo pipefail

LOGFILE="/tmp/pi-fix-log.txt"
SETTINGS="$HOME/.pi/agent/settings.json"
TS=$(date +%Y%m%d_%H%M%S)
BAK="${SETTINGS}.bak.${TS}"

# ── 0. Header ──────────────────────────────────────────────────────────────────
log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*" | tee -a "$LOGFILE"; }

: > "$LOGFILE"   # truncate log
log "=== fix-pi-start — $TS ==="

# ── 1. Kill all pi processes ───────────────────────────────────────────────────
log "Killing pi/pi-coding-agent processes …"
pkill -f 'pi-coding-agent' 2>/dev/null || true
pkill -x 'pi' 2>/dev/null || true
sleep 1
# Force-kill stragglers
pkill -9 -f 'pi-coding-agent' 2>/dev/null || true
pkill -9 -x 'pi' 2>/dev/null || true
sleep 1
# Re-check and report raw output
REMAINING=$(pgrep -fl 'pi-coding-agent|^pi$| pi$' 2>/dev/null || true)
if [[ -n "$REMAINING" ]]; then
  log "Remaining pi-related processes (raw):"
  echo "$REMAINING" | tee -a "$LOGFILE"
else
  log "No remaining pi processes found."
fi

# ── 2. Backup settings.json ───────────────────────────────────────────────────
if [[ -f "$SETTINGS" ]]; then
  cp "$SETTINGS" "$BAK"
  log "Backup → $BAK"
else
  log "WARN: $SETTINGS not found — nothing to back up."
fi

# ── 3. Strip fireworks entries & fix defaultModel ──────────────────────────────
if [[ -f "$SETTINGS" ]]; then
  node -e "
    const fs = require('fs');
    const p = process.env.HOME + '/.pi/agent/settings.json';
    const s = JSON.parse(fs.readFileSync(p, 'utf8'));

    // Strip enabledModels entries matching /fireworks/
    if (Array.isArray(s.enabledModels)) {
      const before = s.enabledModels.length;
      s.enabledModels = s.enabledModels.filter(m => !/fireworks/i.test(m));
      if (s.enabledModels.length !== before)
        console.log('Stripped ' + (before - s.enabledModels.length) + ' fireworks model(s).');
      else
        console.log('No fireworks models found in enabledModels.');
    }

    // Fix defaultModel: glm-5.2-fast → glm-5.2
    if (s.defaultModel === 'glm-5.2-fast') {
      s.defaultModel = 'glm-5.2';
      console.log('Changed defaultModel: glm-5.2-fast → glm-5.2');
    } else {
      console.log('defaultModel is already: ' + s.defaultModel);
    }

    fs.writeFileSync(p, JSON.stringify(s, null, 2) + '\n');
    console.log('Settings written.');
  " 2>&1 | tee -a "$LOGFILE"
else
  log "WARN: skipping node fix — settings file missing."
fi

# ── 4. Verify no fireworks remain ──────────────────────────────────────────────
log "Verifying settings.json is clean …"
if [[ -f "$SETTINGS" ]]; then
  HITS=$(grep -ci 'fireworks' "$SETTINGS" || true)
  if [[ "$HITS" -eq 0 ]]; then
    log "[OK] No fireworks references found."
  else
    log "[FAIL] $HITS fireworks reference(s) still present!"
    grep -ni 'fireworks' "$SETTINGS" | tee -a "$LOGFILE"
  fi
else
  log "WARN: cannot verify — settings file missing."
fi

# ── 5. Dump settings summary ───────────────────────────────────────────────────
log "--- Current settings.json ---"
if [[ -f "$SETTINGS" ]]; then
  cat "$SETTINGS" | tee -a "$LOGFILE"
  echo | tee -a "$LOGFILE"
fi
log "--- End settings ---"

# ── 6. Start pi with output tee'd to log ───────────────────────────────────────
log "Starting pi (foreground) …"
log "Log file: $LOGFILE"
echo '' | tee -a "$LOGFILE"

# Run pi, tee both stdout and stderr so user sees it live AND it's captured.
pi 2>&1 | tee -a "$LOGFILE"
PI_EXIT=$?

log "pi exited with code $PI_EXIT"
exit $PI_EXIT
