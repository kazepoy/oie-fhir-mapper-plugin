# patient-r4 context resources

[Demo channels](../../oie-init/README.md) · [Hades](../../term-server/README.md)

The **patient-r4** context in **Settings → FHIR Mapper** configures:

- FHIR version **R4**;
- resource location **/fhir-volume/02-adt-patient-context**;
- terminology server **http://term-server:8500/fhir**;
- validation **always**, cache **0 seconds**, HTTP timeout **5 seconds**.

Its base resources are:

| File | Purpose |
|---|---|
| [StructureDefinition-DemoPatient.json](StructureDefinition-DemoPatient.json) | Patient profile requiring at least one identifier, a name and a gender. |
| [ValueSet-patient-gender.json](ValueSet-patient-gender.json) | The four permitted FHIR genders, used by the profile. |
| [AdtA28ToDemoPatient.fml](AdtA28ToDemoPatient.fml) | A28 transformation through OieMessage, adding `meta.profile` and translating gender remotely. |

Destination 2 of **02 ADT A28 to Patient - Terminology** selects this context and
its map, with no inline FML or local terminology override. The target profile
is declared in both `uses … as target` and `meta.profile`.

The translation ConceptMap is preloaded in Hades.

## Nested imports and primary model selection

The **Nested imports and multiple models** step, second in destination 2 of
channel 02, receives the Patient produced by the first step.

- [PatientToBundle.fml](PatientToBundle.fml) imports `CopyPatient`.
- [CopyPatient.fml](CopyPatient.fml) imports `CopyPatientIdentity`.
- [CopyPatientIdentity.fml](CopyPatientIdentity.fml) copies the identifier and name.

The main map declares two sources (`OieMessage`, `Patient`) and three targets
(`Organization`, `Patient`, `Bundle`). The first group is:

```fml
group PatientToBundle(source src : InputPatient, target bundle : OutputBundle)
```

The plugin resolves **InputPatient → Patient** and **OutputBundle → Bundle**
from this group's typed parameters and the matching source/target `uses`
declarations. It does not select the first `uses` declaration. Multiple declared
models do not mean multiple input messages: this step receives one source
parameter and builds one primary target.

The collection Bundle contains the copied Patient and an Organization created
by the main map. It is validated and stored in the Channel Map variable
**fmlImportedBundle**. The destination retains its Patient output; the new step's
trace is **FML_TRACE_D2_S1**. Its Test sample is the prepared Patient JSON.

The [expected Bundle](../../oie-init/data/samples/adt-a28/imported-bundle.json)
and [targeted test](../../../webadmin/test/e2e/dev-fml-imports.test.js) check model
resolution, both import levels and the deployed pipeline. The validator may
report the usual missing-narrative warnings on both resources; they do not block
processing.
