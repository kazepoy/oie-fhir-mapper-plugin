# Active demo FHIR resources

[Channels](../oie-init/README.md) · [Demo](../../doc/fr/demo/Demo.md)

This directory is mounted read-only in OIE at `/fhir-volume`. Numeric prefixes
match the channels that introduce the resources. Shared files are grouped by
domain; channels 01 and 03 use inline maps and need no server resource directory.

| Directory | Resources and purpose |
|---|---|
| [02-adt-patient-context](02-adt-patient-context/README.md) | Patient profile, ValueSet and maps for the Settings context `patient-r4`, including nested imports. |
| [04-hl7v2-pid-fr-core-ins](04-hl7v2-pid-fr-core-ins/) | PID logical model, FR Core INS map and supplementary INSEE terminology. |
| [05-fhir-patient-normalization](05-fhir-patient-normalization/README.md) | FHIR Patient normalization map. |
| [06-json-order-to-dispatch](06-json-order-to-dispatch/README.md) | Source and target JSON logical models, and order-to-dispatch map. |
| [07-csv-permission-r5](07-csv-permission-r5/README.md) | R5 FML creating Organization and Permission resources. |
| [08-oru-patient-structuremap](08-oru-patient-structuremap/README.md) | Published JSON StructureMap for the PID segment of an ORU message. |
| [shared/lab-r4](shared/lab-r4/README.md) | Laboratory profiles, CodeSystem and ConceptMaps used by 08, 09 and 10. |
| [11-hl7v2-patient-ig-tgz](11-hl7v2-patient-ig-tgz/README.md) | `.tgz` IG package (`DevDaysIGtutorial-Patient`) used by 11. |

Channel 02's ConceptMap is served by [term-server](../term-server/README.md).
