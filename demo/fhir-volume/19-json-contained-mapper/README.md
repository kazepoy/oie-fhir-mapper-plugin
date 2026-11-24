# 19-json-contained-mapper

[FHIR volume index](../README.md) · [Channels](../../oie-init/README.md)

Profiles used by channel **19 JSON to Contained - Mapper** (`10819/patient-contained/`):

- [DiagnosticReportWithContained.json](DiagnosticReportWithContained.json): constrains `DiagnosticReport.contained:observation` to `ContainedObservation` (FHIR R4).
- [ContainedObservation.json](ContainedObservation.json): concrete `Observation` profile used inside `DiagnosticReport.contained`.
