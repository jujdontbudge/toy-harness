#!/bin/zsh
cd "${0:A:h}/../.." || exit 0
cat >/dev/null
if [[ -f build/DONE ]]; then
  exit 0
fi
if [[ -f build/PAUSE ]]; then
  resume_after=$(head -1 build/PAUSE 2>/dev/null)
  if [[ "$resume_after" == <-> ]] && (( resume_after > $(date +%s) )); then
    exit 0
  fi
  rm -f build/PAUSE
fi
print -r -- '{"decision":"block","reason":"build/DONE does not exist, so the Toy build is not finished. Do not stop. Reload build/state.json and build/progress.md, pick the next unblocked card in specs/BUILD-PLAN.md, and keep working. If every remaining card is blocked only on Johan or a running timer, write build/PAUSE with the epoch seconds to resume at on line 1 and the reason on line 2, update build/HUMAN-STEPS.md, then stop."}'
