# JSON StructureMap: ORU to Patient

[Active volume](../README.md) · [Channel 08](../../oie-init/data/channels/08-oru-patient-structuremap.xml)

[StructureMap-OruR01ToPatientIG.json](StructureMap-OruR01ToPatientIG.json) is a
published JSON map selected by its canonical URL. It uses OieMessage and produces
a Patient conforming to ExampleLabPatient. The local context loads this
directory and [shared/lab-r4](../shared/lab-r4/README.md).

This example distinguishes a JSON StructureMap from a text FML file. **Copy to
inline map** renders executable FML with the engine's `///` header. A message
without a birth date checks the profile constraint. The historical export is
`oru-r01-to-fhir-patient-fml-ig.xml`.
