# HL7v2 to Patient with IG `.tgz`

[Demo](../../../doc/fr/demo/Demo.md) · [Channel](../../oie-init/data/channels/11-hl7v2-patient-ig-tgz.xml)

**11 HL7v2 to Patient - IG tgz** receives an ADT A28 message at
`http://localhost:10808/devdays-patient/` and produces a `Patient` conforming to
`DevDaysIGtutorial-Patient`.

The FML step loads
[devdays.r4.example.conformanceresources-1.0.0.tgz](devdays.r4.example.conformanceresources-1.0.0.tgz)
at `/fhir-volume/11-hl7v2-patient-ig-tgz/devdays.r4.example.conformanceresources-1.0.0.tgz`,
translates gender via `http://term-server:8500/fhir`, and validates the output
against the profile.

```sh
curl --fail --header 'Content-Type: text/plain; charset=UTF-8' \
  --data-binary @demo/oie-init/data/samples/adt-a28.er7 \
  http://localhost:10808/devdays-patient/
```
