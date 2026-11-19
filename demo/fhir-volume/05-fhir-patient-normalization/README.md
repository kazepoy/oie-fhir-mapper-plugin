# FHIR to FHIR: PatientDemo

[Demo](../../../doc/fr/demo/Demo.md) · [Channel](../../oie-init/data/channels/05-fhir-patient-normalization.xml)

**05 FHIR Patient - Normalize Identity** receives a FHIR Patient JSON message at
`http://localhost:10802/fhir-patient/`. Its single FML step uses the
**FHIR resource** source mode: the Patient model already exists in R4 core.
No business logical model, OieMessage or JavaScript preparation is required.

[PatientDemo.map](PatientDemo.map) copies the identity, uppercases the family name and sets `active` to `true`. The target
Patient is validated against its base FHIR definition.

- [Input Patient](../../oie-init/data/samples/05-fhir-patient-normalization/input.json)
- [Expected Patient](../../oie-init/data/samples/05-fhir-patient-normalization/expected.json)

The sample is saved with the FML step. From the repository root:

```sh
curl --fail --show-error \
  --header 'Content-Type: application/fhir+json; charset=UTF-8' \
  --data-binary @demo/oie-init/data/samples/05-fhir-patient-normalization/input.json \
  http://localhost:10802/fhir-patient/
```
