# R0.05 control runtime probe review

**Verdict: blocked before the physical root request.** This is a read-only source review; it does not establish runtime behavior or pass an acceptance test.

The probe does not check that UID/GID 310 can traverse every ancestor that remains unchanged. The staging verifier checks that those ancestors are not group/other writable, which still admits a root-owned `Toy` directory at mode `0700`. The probe then opens only `control` and `control/releases`. If an unchanged ancestor denies traversal, the child cannot reach the staged payload after the root permission window opens. Add a fail-closed traversal preflight for the complete fixed path before either chmod.

Restoration also depends on `finally`. Default SIGINT/SIGTERM termination bypasses that block and can leave both protected parent directories at mode `0711`. Add a restoration path for ordinary signals or a separately guaranteed and verified restoration step before treating this request as runnable.

The reviewed child drops to the measured identity before the frozen Secrets dynamic import, and the Python helper uses ignored stdin/stdout/stderr, so credential bytes do not enter the Node report path by inspection. No physical execution or AT verification was performed. At review time, `build/ROOT-REQUESTS.md` contains the completed staging request but no new runtime-probe request.

Scope note: an initial inventory command included read-only `git status`, and an accidental read-only `stat` inspected `/Library` and `/Library/Application Support`. Neither changed files or system state. No Toy runtime, root command, browser, service, or Keychain operation was performed.
