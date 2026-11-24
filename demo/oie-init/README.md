# Demo channels

[Demo](../../doc/fr/demo/Demo.md) · [FHIR resources](../fhir-volume/README.md) · [JSON catalog](examples.json)

The demo contains eighteen channels in the **FML OieMessage**, **FML logical** and
**Mapper transformer** groups.

| Channel | Endpoint | Purpose |
|---|---|---|
| [01 ADT A28 to Patient - Inline FML](data/channels/01-adt-a28-patient-inline-fml.xml) | `http://localhost:10804/simple-fml/` | A28 → Patient; inline FML and native OIE XML, with no JavaScript preparation. |
| [02 ADT A28 to Patient - Terminology](data/channels/02-adt-a28-patient-terminology.xml) | `http://localhost:10805/fml-terminology/` | Remote terminology, Settings context, profile and nested FML imports. |
| [03 HL7v2 to Patient - OieMessage](data/channels/03-hl7v2-patient-oiemessage.xml) | `http://localhost:10800/oru-patient/` | OieMessage: standard/strict v2 and prepared XML, JSON or text input. |
| [04 HL7v2 PID to FR Core INS](data/channels/04-hl7v2-pid-fr-core-ins.xml) | `http://localhost:10801/pid-fr-core-ins/` | Native HAPI XML, PID logical SD and FR Core INS Patient target. |
| [05 FHIR Patient - Normalize Identity](data/channels/05-fhir-patient-normalization.xml) | `http://localhost:10802/fhir-patient/` | FHIR Patient: copy identity, uppercase family name and set active=true. |
| [06 JSON Order to Dispatch](data/channels/06-json-order-to-dispatch.xml) | `http://localhost:10803/commande-json/` | Two business JSON models; neither input nor output is a FHIR resource. |
| [07 CSV to R5 Permission - FML](data/channels/07-csv-permission-r5-fml.xml) | `http://localhost:10814/permission-r5/` | CSV → R5 Organization + Permission transaction. |
| [08 ORU to Patient - StructureMap](data/channels/08-oru-patient-structuremap.xml) | `http://localhost:10815/patient-fml-ig/` | Published JSON StructureMap; local validation and copy to inline FML. |
| [09 CSV to Patient Bundle - Mapper](data/channels/09-csv-patient-bundle-mapper.xml) | `http://localhost:10806/csv-patients-collection/` | CSV cleanup, accents and leading zeroes; collection of ten Patients. |
| [10 ORU to Lab Bundle - Mapper](data/channels/10-oru-lab-transaction-mapper.xml) | `http://localhost:10807/oru/` | Clinical transaction, repeated OBXs and references between twelve resources. |
| [11 HL7v2 to Patient - IG tgz](data/channels/11-hl7v2-patient-ig-tgz.xml) | `http://localhost:10808/devdays-patient/` | ADT A28 → DevDaysIGtutorial-Patient with `.tgz` IG package and Hades terminology. |
| [12 ORU to Two Lab Bundles - Mapper](data/channels/12-oru-two-lab-bundles-mapper.xml) | `http://localhost:10811/labo/` | Two parallel Bundles (transaction and document) sharing the same clinical resources. |
| [13 SQL XML to Patient - Mapper](data/channels/13-sql-xml-patient-mapper.xml) | `http://localhost:10812/sql-patient/` | Simulated SQL XML row to Patient with preserved accents and leading zeroes. |
| [14 JSON to Obs Ext TX - Mapper](data/channels/14-json-obs-external-tx-mapper.xml) | `http://localhost:10816/obs-external-tx/` | External terminology `ConceptMap/$translate` and unmatched fallback via `term-server`. |
| [16 JSON to R5 Org - Mapper](data/channels/16-json-organization-r5-mapper.xml) | `http://localhost:10810/organization-r5/` | Business JSON to FHIR R5 Organization with R5 markdown `description`. |
| [17 ORU to Patient - FML vs Mapper](data/channels/17-oru-patient-fml-vs-mapper.xml) | `http://localhost:10817/patient-compare/` | Parallel destinations comparing inline FML and Mapper Transform outputs and timings. |
| [18 ADT to Patient - Dynamic FML](data/channels/18-adt-patient-dynamic-fml.xml) | `http://localhost:10818/adt-dynamic-fml/` | A28/A31/A08 → Patient; one destination selects three map/SD pairs from message variables. |
| [19 JSON to Contained - Mapper](data/channels/19-json-contained-mapper.xml) | `http://localhost:10819/patient-contained/` | Business JSON to FHIR R4 `DiagnosticReport` with a profiled `contained` `Observation`. |

## Sources and resources

Each step carries its Test sample. Server resources are described in the
[FHIR volume index](../fhir-volume/README.md). Samples and expected results
are in [data/samples](data/samples/), including shared payloads under
[restored](data/samples/restored/).

01 and 02 receive **ADT A28** messages; the source produces native OIE XML without
any step. The Settings context **patient-r4** loads
`/fhir-volume/02-adt-patient-context` and uses [Hades](../term-server/README.md).
Destination 2 of channel 02 runs its map from the context, then the **Nested
imports and multiple models** step produces a Bundle in `fmlImportedBundle`.
Monitoring traces are stored in `FML_TRACE_D2_S0` and `FML_TRACE_D2_S1`.

The profile and imports are described in
[02-adt-patient-context](../fhir-volume/02-adt-patient-context/README.md).
Channel 02's HTTP response remains that of destination 1; its destinations
are independent, with Wait for previous disabled.

## Replay an example

From the repository root:

```sh
curl --fail --header 'Content-Type: text/plain; charset=UTF-8' \
  --data-binary @demo/oie-init/data/samples/adt-a28.er7 \
  http://localhost:10804/simple-fml/

node --test webadmin/test/e2e/dev-restored-examples.test.js
```

Initialization uses [init-channels.sh](../oie-init/init-channels.sh),
[configuration.xml](data/configuration.xml) and the [groups](data/groups/).
It restores the demo; for an individual update, import only the relevant
channels to preserve other local settings.
