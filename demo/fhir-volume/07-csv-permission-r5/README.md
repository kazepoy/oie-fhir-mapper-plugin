# CSV to R5 Permission

[Active volume](../README.md) · [Channel 07](../../oie-init/data/channels/07-csv-permission-r5-fml.xml)

[CsvToPermissionR5.fml](CsvToPermissionR5.fml) transforms native OIE CSV columns
through OieMessage into an R5 transaction Bundle: an Organization and a Permission
with a resolved asserter reference. FHIR R5 core is sufficient; no IG package is
required.

The step's Test sample uses the incoming CSV with its DELIMITED options. Samples
include an invalid Permission status to check rejection.
