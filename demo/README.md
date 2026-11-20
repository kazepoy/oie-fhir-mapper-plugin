# OIE FHIR Mapper demo

The demo uses [oie-init](oie-init/README.md) and
[fhir-volume](fhir-volume/README.md): seventeen channels in the
**FML transformer** and **Mapper transformer** groups.

The [launch guide](../doc/fr/demo/Demo.md) describes Compose and prerequisites.
The [Hades terminology server](term-server/README.md) is available on port 8500.
The [channel catalog](oie-init/examples.json) lists each example's name, port,
input and resources.

Regenerate README and manual screenshots with
`npm --prefix webadmin run capture:docs` from the repository root. See the
[capture procedure](../doc/fr/demo/Captures.md).
