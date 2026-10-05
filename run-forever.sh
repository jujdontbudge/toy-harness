#!/bin/zsh
cd "${0:A:h}" || exit 1
export DEVIN_PERMISSION_MODE=dangerous
first=1
until [[ -f build/DONE ]]; do
  if [[ -f build/PAUSE ]]; then
    resume_after=$(head -1 build/PAUSE)
    now=$(date +%s)
    if [[ "$resume_after" == <-> ]] && (( resume_after > now )); then
      sleep $(( resume_after - now < 900 ? resume_after - now : 900 ))
      continue
    fi
    rm -f build/PAUSE
  fi
  if (( first )) && [[ ! -f build/state.json ]]; then
    caffeinate -dimsu devin -p "$(cat START-PROMPT.txt)"
  else
    caffeinate -dimsu devin --continue -p "Continue the Toy build exactly per DEVIN-PROMPT.md and AGENTS.md. Reload build/state.json and build/progress.md first, then keep working on the next unblocked card. Never stop until build/DONE exists."
  fi
  first=0
  sleep 30
done
print "Toy build complete: see build/DONE"
