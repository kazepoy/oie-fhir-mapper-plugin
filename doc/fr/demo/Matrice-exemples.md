# Matrice des canaux et exemples

[Démonstration](README.md) · [Guide de la démo](Demo.md) · [Catalogue JSON](../../../demo/oie-init/examples.json)

La démonstration active déploie **dix-sept canaux** (`01` à `17`) répartis en deux groupes natifs OIE : **FML transformer** (9 canaux) et **Mapper transformer** (8 canaux). Chaque étape contient un sample préchargé testable directement dans l'onglet **Test**.

## Groupe `FML transformer`

| Canal | Port et route | Modèle source | Ressources serveur (`/fhir-volume`) | Capacités démontrées |
|---|---|---|---|---|
| [01 ADT A28 to Patient - Inline FML](../../../demo/oie-init/data/channels/01-adt-a28-patient-inline-fml.xml) | `10804/simple-fml/` | `oie-message` | *(aucune : map inline)* | Map FML écrite dans l'étape (`mapSource`) sur le XML HL7 v2 natif d'OIE. |
| [02 ADT A28 to Patient - Terminology](../../../demo/oie-init/data/channels/02-adt-a28-patient-terminology.xml) | `10805/fml-terminology/` | `oie-message` | `02-adt-patient-context` + Hades (`:8500`) | Contexte Settings `patient-r4`, `translate()` distant via Hades, imports FML imbriqués et traces `FML_TRACE_D2_S0` / `S1`. |
| [03 HL7v2 to Patient - OieMessage](../../../demo/oie-init/data/channels/03-hl7v2-patient-oiemessage.xml) | `10800/oru-patient/` | `oie-message` | *(aucune : maps inline)* | Cinq destinations comparant HL7 v2 standard, Strict Parser et entrées préparées XML, JSON et texte. |
| [04 HL7v2 PID to FR Core INS](../../../demo/oie-init/data/channels/04-hl7v2-pid-fr-core-ins.xml) | `10801/pid-fr-core-ins/` | `logical` (SD logique `PID`) | `04-hl7v2-pid-fr-core-ins` + `fr-core-2.2.0` | XML HAPI du Strict Parser lu via une `StructureDefinition` logique `PID` vers `FRCorePatientINSProfile`. |
| [05 FHIR Patient - Normalize Identity](../../../demo/oie-init/data/channels/05-fhir-patient-normalization.xml) | `10802/fhir-patient/` | `fhir` (`Patient`) | `05-fhir-patient-normalization` | Ressource FHIR R4 entrante transformée en ressource FHIR R4 normalisée. |
| [06 JSON Order to Dispatch](../../../demo/oie-init/data/channels/06-json-order-to-dispatch.xml) | `10803/commande-json/` | `logical` (SD logique `CommandeSource`) | `06-json-order-to-dispatch` | Deux modèles logiques métier JSON non FHIR (`CommandeSource` → `BonPreparation`), validation FHIR désactivée. |
| [07 CSV to R5 Permission - FML](../../../demo/oie-init/data/channels/07-csv-permission-r5-fml.xml) | `10814/permission-r5/` | `oie-message` | `07-csv-permission-r5` | CSV (`DELIMITED`) vers Bundle `transaction` FHIR R5 contenant `Organization` et `Permission`. |
| [08 ORU to Patient - StructureMap](../../../demo/oie-init/data/channels/08-oru-patient-structuremap.xml) | `10815/patient-fml-ig/` | `oie-message` | `08-oru-patient-structuremap` + `shared/lab-r4` | `StructureMap` JSON publiée appelée par `mapUrl`, validation locale et copie vers l'éditeur inline. |
| [11 HL7v2 to Patient - IG tgz](../../../demo/oie-init/data/channels/11-hl7v2-patient-ig-tgz.xml) | `10808/devdays-patient/` | `oie-message` | `11-hl7v2-patient-ig-tgz` + Hades (`:8500`) | Chargement d'un package IG `.tgz` (`DevDaysIGtutorial-Patient`) et traduction terminologique sur Hades. |

## Groupe `Mapper transformer`

| Canal | Port et route | Entrée | Ressources serveur (`/fhir-volume`) | Capacités démontrées |
|---|---|---|---|---|
| [09 CSV to Patient Bundle - Mapper](../../../demo/oie-init/data/channels/09-csv-patient-bundle-mapper.xml) | `10806/csv-patients-collection/` | CSV → XML nettoyé | `shared/lab-r4` | Nettoyage CSV en source, itération racine en destination vers un Bundle `collection` de 10 Patients (sample `scope: "transformer"`). |
| [10 ORU to Lab Bundle - Mapper](../../../demo/oie-init/data/channels/10-oru-lab-transaction-mapper.xml) | `10807/oru/` | HL7 v2 ER7 | `shared/lab-r4` | Bundle `transaction` de 12 ressources (7 étapes), itérations `OBR`/`OBX`/`SPM`, `fhirRef`, traductions locales et `fhirMapperTrace`. |
| [12 ORU to Two Lab Bundles - Mapper](../../../demo/oie-init/data/channels/12-oru-two-lab-bundles-mapper.xml) | `10811/labo/` | HL7 v2 ER7 | `shared/lab-r4` | Deux Bundles (`transaction` et `document`) partageant les mêmes ressources cliniques, variable `bundleDocument` et archivage PCA/PRA. |
| [13 SQL XML to Patient - Mapper](../../../demo/oie-init/data/channels/13-sql-xml-patient-mapper.xml) | `10812/sql-patient/` | XML (ligne SQL) | `shared/lab-r4` | Mapping XML direct vers `ExampleLabPatient`, préservation des accents et des zéros initiaux de l'IPP. |
| [14 JSON to Obs Ext TX - Mapper](../../../demo/oie-init/data/channels/14-json-obs-external-tx-mapper.xml) | `10816/obs-external-tx/` | JSON métier | Contexte `external-terminology` | Traduction distante via `ConceptMap/$translate` sur `term-server` (`GLU` → LOINC, repli `data-absent-reason#unknown`). |
| [16 JSON to R5 Org - Mapper](../../../demo/oie-init/data/channels/16-json-organization-r5-mapper.xml) | `10810/organization-r5/` | JSON métier | Core FHIR R5 | Ressource `Organization` en FHIR R5, champ `description` de type `markdown` et diagnostic de conversion booléenne. |
| [17 ORU to Patient - FML vs Mapper](../../../demo/oie-init/data/channels/17-oru-patient-fml-vs-mapper.xml) | `10817/patient-compare/` | HL7 v2 ER7 | Contexte `demo-labo` | Double destination parallèle (Destination 1 en FML inline, Destination 2 en Mapper Transform) vérifiant l'égalité des Patients produits. |

## Vérification automatisée

Depuis la racine du dépôt :

```sh
node --test tools/tests/*.test.mjs
node tools/run_tests.mjs --offline demo/oie-init/data/channels
npm --prefix webadmin run test:e2e
```
