# ADT to Patient with dynamic map and logical model

[Channel 18](../../oie-init/data/channels/18-adt-patient-dynamic-fml.xml) · [Demo channels](../../oie-init/README.md)

**18 ADT to Patient - Dynamic FML** receives HL7 v2 messages at
`http://localhost:10818/adt-dynamic-fml/` and returns a FHIR R4 Patient.

The source uses **Strict Parser** with **Strip Namespaces**. Its filter accepts
only ADT A28, A31 and A08 and sets `fmlMapUrl` and `fmlSourceModelUrl`.
The source publishes native XML. One destination extracts the PID, then runs a
single FML step configured with `${fmlMapUrl}` and `${fmlSourceModelUrl}`.

| Event | FML map | Logical source SD |
|---|---|---|
| A28 | [AdtA28ToPatient](AdtA28ToPatient.fml) | [PidA28](StructureDefinition-PidA28.json) |
| A31 | [AdtA31ToPatient](AdtA31ToPatient.fml) | [PidA31](StructureDefinition-PidA31.json) |
| A08 | [AdtA08ToPatient](AdtA08ToPatient.fml) | [PidA08](StructureDefinition-PidA08.json) |

The three SDs describe native PID XML under distinct canonical URLs. Dotted XML
names are declared with `xml-name`; text values use `xmlText`. The maps copy the
identifier, name, birth date and gender. Each output has a `meta.tag` containing
the selected ADT event. Output validation and step tracing are enabled.

## Send a message

From the repository root:

```sh
curl --fail --header 'Content-Type: text/plain; charset=UTF-8' \
  --data-binary @demo/oie-init/data/samples/18-adt-patient-dynamic-fml/adt-a28.er7 \
  http://localhost:10818/adt-dynamic-fml/

node --test webadmin/test/e2e/dev-fml-dynamic-channel.test.js
```

Use `adt-a31.er7` or `adt-a08.er7` at the same endpoint for the other events.
[Samples and expected Patients](../../oie-init/data/samples/18-adt-patient-dynamic-fml/)
include all three cases.

## Test the FML step

Open destination **Dynamic ADT to Patient**, step **Patient using the selected
map and model**, then **Test**. The prepared A28 PID XML and both variable
values are saved with the step. Click **Run test** directly. **Test variables (2)**
is collapsed and contains:

- `fmlMapUrl`: `http://example.org/fml-dynamic/StructureMap/AdtA28ToPatient`;
- `fmlSourceModelUrl`: `http://example.org/fml-dynamic/StructureDefinition/PidA28`.

For A31 or A08, paste the corresponding `pid-*.xml` sample and use the values in
`variables-*.json`. The Test tab does not execute the source filter or PID
extraction step. **Resolved references** shows both URLs used for the preview.

In Messages, destination 1's Channel Map contains both selected variables and
`FML_TRACE_D1_S1`, including the resolved URLs, source, output and validation.
