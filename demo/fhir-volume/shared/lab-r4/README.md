# Shared R4 laboratory resources

[Active volume](../../README.md) · [Channels](../../../oie-init/README.md)

This directory groups the shared R4 laboratory profiles (with the published StructureMap
stored in `08-oru-patient-structuremap`). It contains Patient,
Observation, Specimen, ServiceRequest, DiagnosticReport, Bundle and extension
profiles, plus v2/laboratory code ConceptMaps.

- **08** uses the Patient profile and its JSON StructureMap.
- **09** produces a collection of ten Patients after business CSV cleanup.
- **10** assembles a clinical transaction with internal references, numeric
  observations and a laboratory comment.

Profiles and terminologies are local; these three channels need no external
server. They do not constitute a published IG package. Public packages required
by the logical PID example are provided in `/fhir-packages` by the OIE image.
