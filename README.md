# OIE FHIR Mapper

> **Status: In development (pre-1.0).**

A plugin for [Open Integration Engine](https://github.com/OpenIntegrationEngine/engine)
(OIE 4.7, Web Admin 1.3). It builds FHIR resources and Bundles from business
messages.
It requires the [**FHIR Data Type**](https://github.com/matthydehoog/fhir-datatype-Eclipse-OIE)
plugin, version 1.6.1 ([release](https://github.com/matthydehoog/fhir-datatype-Eclipse-OIE/releases/tag/v1.6.1)).
OIE FHIR Mapper is a separate project, not part of FHIR Data Type: please report
bugs in [GitHub Issues](https://github.com/kazepoy/oie-fhir-mapper-plugin/issues)
and use [GitHub Discussions](https://github.com/kazepoy/oie-fhir-mapper-plugin/discussions)
for questions, feedback and ideas.

## Try it

```sh
git clone https://github.com/kazepoy/oie-fhir-mapper-plugin.git
cd oie-fhir-mapper-plugin/demo
docker compose up -d --build
```

Administration: <https://localhost:8443/oie-webadmin/> (`admin` /
`admin`). See the [demo guide](doc/fr/demo/Demo.md) (in French).

The demo uses `demo/fhir-volume` for FHIR resources,
`demo/oie-init/data` for its configuration, groups, tags and 17 channels, and
`demo/term-server` for remote terminology.

## FHIR Mapper Transform

A transformer step that maps a message onto a FHIR profile: profile tree, slices,
expressions, conditions, iterations, translations, references between resources,
FHIR validation and per-rule diagnostics. Expressions are edited in Web Admin's code
editor with completion (mapper functions, iteration variables, sample paths,
references of other steps); sample messages and their expected results are saved
with the step.

![FHIR Mapper Transform in a transformer](doc/fr/user-manual/images/fhir-mapper.png)

## FHIR FML Transform

A second transformer step, next to the Mapper Transform: it runs an FML map
(StructureMap) on an inbound FHIR resource, a logical model (XML or JSON,
including HL7 v2 Strict Parser XML, described by a `StructureDefinition`), or a
generic OIE model (`OieMessage`), then validates and publishes the result. The
map is a file of the profile locations, or is written in the step itself, in an
itself, in an editor with highlighting, completion, syntax check and skeleton
generation. It uses the FML engine of the HL7 core
that FHIR Data Type ships, with no extra library.

![FHIR FML Transform with inline map](doc/fr/user-manual/images/fhir-fml.png)

## Documentation

Detailed documentation is in French:

- [Documentation hub](doc/README.md): French docs (`doc/fr/`) and [agent manual](doc/agent-manual/README.md)
- [Illustrated user manual](doc/fr/user-manual/README.md): Mapper Transform, FML and Settings, with feature-by-feature procedures and screenshots
- [Mapping format and execution](doc/fr/reference/Specification-mapping.md)
- [Demo](doc/fr/demo/Demo.md)

License: [Mozilla Public License 2.0](LICENSE).
