# Demo terminology server

[Demo](../README.md) · [Demo channels](../oie-init/README.md)

Hades **2.0.282** directly serves the five FHIR R4 files in
[resources](resources/), mounted read-only.

## Start and connect

From the repository root:

```sh
docker compose -f demo/compose.yaml up -d --build --no-deps term-server
```

- From OIE: `http://term-server:8500/fhir`.
- From the host: `http://localhost:8500/fhir` (override with `TERM_SERVER_PORT`).
- Readiness: `http://localhost:8500/fhir/metadata`.

The service is included in Compose; channel initialization waits for it to be
healthy. To load more files, add them to `resources/` and restart only
`term-server`.

## Preloaded resources

- Demo subset of HL7 v2 table 0001: `F`, `M`, `O`, `U` (CodeSystem declared as a
  `fragment`, not a complete copy of the table).
- FHIR `administrative-gender` CodeSystem: `female`, `male`, `other`, `unknown`.
- Both corresponding ValueSets.
- ConceptMap `http://example.org/fml-demo/ConceptMap/v2-sex-to-gender`, with
  `F → female`, `M → male`, `O → other`, `U → unknown`.

```sh
curl --fail --get 'http://localhost:8500/fhir/ConceptMap/$translate' \
  --data-urlencode 'url=http://example.org/fml-demo/ConceptMap/v2-sex-to-gender' \
  --data-urlencode 'system=http://terminology.hl7.org/CodeSystem/v2-0001' \
  --data-urlencode 'code=F'
```

## Channel 02: Patient and remote translation

[02 ADT A28 to Patient - Terminology](../oie-init/data/channels/02-adt-a28-patient-terminology.xml)
follows channel 01's simple pipeline: ADT A28 ER7 → native OIE XML in the source,
then inline FML using OieMessage in the destination. Gender is produced by:

```fml
code.value as v -> patient.gender = translate(v,
  'http://example.org/fml-demo/ConceptMap/v2-sex-to-gender', 'code') "gender";
```

The step's server is `http://term-server:8500/fhir` with empty resource locations,
caching disabled, FHIR validation enabled and tracing enabled. The trace is
stored as `FML_TRACE_D1_S0` in message monitoring.

```sh
curl --fail --header 'Content-Type: text/plain; charset=UTF-8' \
  --data-binary @demo/oie-init/data/samples/adt-a28.er7 \
  http://localhost:10805/fml-terminology/

node --test webadmin/test/e2e/dev-fml-terminology.test.js
```

[terminology.http](terminology.http) provides ready-to-run requests: capabilities,
code lookup, expansion and translation.

The channel's second destination uses the Settings context **patient-r4** with
[simple resources](../fhir-volume/02-adt-patient-context/README.md). It inherits
the Hades URL and loads its map from the context resources. The ConceptMap
remains exclusively in Hades for both destinations.

The Test sample contains the XML received by the destination. The expected
result is the [shared Patient](../oie-init/data/samples/patient.json).

## How the plugin resolves translate

The effective context supplies the configuration: a Settings context can provide
a URL even when the step has no local value.

1. FML looks for the canonical ConceptMap in its loaded context. If present, the
   FML engine executes it locally without HTTP.
2. If absent, the bridge calls HAPI's remote support through
   `ConceptMap/$translate`, provided a server URL is configured.
3. With neither a server nor a local ConceptMap, the transformation reports the
   missing map.

A local ConceptMap with no matching entry does not trigger a second remote
attempt. FHIR output validation also uses the server as a fallback to local
support. For single-code R4 FML calls, the bridge sends `code` and `system`
parameters.

## HTTP logs

Request logging is enabled through [logback.xml](logback.xml), mounted in the
container: method, path, IP, HTTP status and duration in milliseconds. Only the
Hades HTTP logger is set to TRACE; other loggers remain at INFO.

```sh
docker compose -f demo/compose.yaml logs -f term-server
```

`/fhir/metadata` requests also come from Docker's healthcheck. FML translation
calls appear with `:method "post"` and the `/fhir/ConceptMap/$translate` path.
