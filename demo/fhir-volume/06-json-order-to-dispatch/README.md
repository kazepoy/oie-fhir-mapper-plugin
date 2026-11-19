# JSON order to JSON dispatch document

[Demo](../../../doc/fr/demo/Demo.md) · [Channel](../../oie-init/data/channels/06-json-order-to-dispatch.xml)

This example demonstrates an FML transformation between **two non-FHIR business
structures**, both described by logical StructureDefinitions:

- [CommandeSource](CommandeSource.json): order number, customer, urgency and lines;
- [BonPreparation](BonPreparation.json): reference, recipient, priority and parcels;
- [CommandeToBon](CommandeToBon.map): rules for converting one into the other.

The SDs are FHIR description resources, but the source and target messages are
not FHIR resources. The `json-suppress-resourcetype` extension tells the
parser/composer not to add `resourceType` to their JSON representation. The
source model is selected from the FML declaration.

The FML copies the order number, builds a recipient from the customer code and
uppercase name, converts the urgency boolean into `express` or `standard`, and
turns each order line into a parcel while preserving its numeric quantity.

**06 JSON Order to Dispatch** receives JSON at
`http://localhost:10803/commande-json/`. Its transformer contains one FML step
using **FHIR resource / Logical model**. The FML declares the CommandeSource
canonical URL; no additional source field is needed. There is no OieMessage,
preparation script or JavaScript business transformation.

FHIR output validation is disabled for this non-FHIR target.

- [Input JSON](../../oie-init/data/samples/06-json-order-to-dispatch/input.json)
- [Expected result](../../oie-init/data/samples/06-json-order-to-dispatch/expected.json)

The sample is saved with the FML step. From the repository root:

```sh
curl --fail --show-error \
  --header 'Content-Type: application/json; charset=UTF-8' \
  --data-binary @demo/oie-init/data/samples/06-json-order-to-dispatch/input.json \
  http://localhost:10803/commande-json/

node --test webadmin/test/e2e/dev-json-models.test.js
```
