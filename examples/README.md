# Example fixtures and API payloads

Input messages, expected FHIR outputs and API request payloads used by unit tests,
replay scripts (`tools/run_tests.mjs`), load scenarios (`tools/load/`) and E2E suites.

For the deployed seventeen-channel demo (`01` to `17`), see the
[demo channel catalog](../demo/oie-init/README.md) and its samples in
`demo/oie-init/data/samples/`.

- `hl7v2/`: ORU messages, Strict Parser XML and expected Patients/Bundles.
- `csv/`: patient tables, R5 Permission inputs and expected results.
- `json/`: business and FHIR inputs, including invalid cases and terminology tests.
- `xml/`: SQL-style XML input and its expected Patient.
- `api/`: preview, diagnostic, trace and translation request payloads.
- [demo.http](demo.http): HTTP requests for testing endpoints and API routes.
- [channels.json](channels.json): fixture manifest for replay and validation tests.

French business field names, clinical text and accented names are intentional
test data. Technical identifiers, canonical URLs and fixture paths are retained
to keep the examples reproducible.
