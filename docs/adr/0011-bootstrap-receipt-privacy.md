# Bootstrap receipt privacy

The packed CLI harness previously retained raw test arguments before validating the result. Those arguments included a synthetic disclosure canary. Even when the CLI rejected that input correctly, the receipt collector archived it. A failed assertion could also archive unvalidated stdout or echo a parser's raw input in its diagnostic.

Receipts now contain the registered case ID, argument count, exit code, stdout/stderr byte counts and protocol-validation state. They contain no argument values or stderr text. Stdout is absent until public-schema validation and disclosure checks succeed. JSON stdout is serialized from the validated public result; human output passes terminal-control and disclosure checks before retention. Failed or unvalidated output remains absent. Setup and parsing failures use fixed diagnostic text.

Each run creates an unpredictable ASCII canary marker, appends terminal-control input for the rejection cases, and checks both raw and reserialized output for the marker. The final archive independently rejects any marker or retained unvalidated output. Owned fixture cleanup runs even when archival fails. This is a change to the collector's data structure and write boundary, rather than guidance to remember redaction.

Seven historical attempt files were converted to this policy. Each conversion preserves the original receipt SHA-256, transformation time and explicit unchanged-acceptance flag. Existing case IDs, exits, validated outputs, invocation counts and source snapshots remain historical evidence. Git history is preserved; the removed test input was synthetic, with no real credential involved.

The compiled, packed executable remains the tested interface. These checks prove only the existing offline/parser and unavailable-state diagnostic subsets. They do not pass the full privacy acceptance assertion or admit future owner content, secret transports, stacks or deployment.
