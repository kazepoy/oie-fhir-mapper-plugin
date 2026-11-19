# Parcours JSON, R5, FR Core et terminologie externe

[Démonstration](README.md) · [Matrice des exemples](Matrice-exemples.md)

Cette page détaille les parcours spécialisés de la démonstration : FHIR R5, profils FR Core 2.2.0, source FHIR directe, modèles logiques JSON non FHIR et serveur de terminologie externe.

| Canal | Groupe | Port et route | Objectif |
|---|---|---|---|
| **04 HL7v2 PID to FR Core INS** | FML transformer | `10801/pid-fr-core-ins/` | XML Strict Parser + modèle logique `PID` vers `FRCorePatientINSProfile` (FR Core 2.2.0). |
| **05 FHIR Patient - Normalize Identity** | FML transformer | `10802/fhir-patient/` | Ressource `Patient` FHIR R4 reçue directement (`sourceModel=fhir`). |
| **06 JSON Order to Dispatch** | FML transformer | `10803/commande-json/` | Modèles logiques JSON source et cible sans ressources FHIR. |
| **07 CSV to R5 Permission - FML** | FML transformer | `10814/permission-r5/` | Source CSV vers `Bundle` transaction R5 (`Organization` + `Permission`). |
| **08 ORU to Patient - StructureMap** | FML transformer | `10815/patient-fml-ig/` | `StructureMap` JSON publiée dans `/fhir-volume/08-oru-patient-structuremap`, appelée par `mapUrl`. |
| **14 JSON to Obs Ext TX - Mapper** | Mapper transformer | `10816/obs-external-tx/` | `ConceptMap/$translate` vers `term-server` et repli `fixed` sur code inconnu. |
| **16 JSON to R5 Org - Mapper** | Mapper transformer | `10810/organization-r5/` | Source JSON métier et champ `Organization.description` (`markdown`) propre à R5. |

## Organization R5 (canal 16)

L'[entrée métier](../../../examples/json/organisation-metier.json) produit l'[Organization attendue](../../../examples/json/organisation-metier-expected.json). La version R5 est configurée sur l'étape et sur les datatypes FHIR du canal. Le champ `description` est de type `markdown`, introduit en FHIR R5.

Dans l'étape **Organization**, ouvrir **Test → Run all** pour rejouer le sample enregistré avec comparaison. L'[entrée invalide](../../../examples/json/organisation-metier-invalide.json) fournit `active: "invalide"` : la conversion échoue sur `Organization.active` avant la validation FHIR.

## Packages FR Core et EU Laboratory dans la démo

L'image Docker télécharge les archives NPM à version fixe et vérifie leurs empreintes SHA-256. Le contexte `fr-core-2.2.0` charge :

1. `hl7.fhir.fr.core#2.2.0` ;
2. `hl7.fhir.uv.extensions.r4#5.2.0` ;
3. `hl7.terminology.r4#7.1.0` ;
4. `ans.fr.terminologies#1.7.0`.

Le contexte `eu-laboratory-2.0.0` charge `hl7.fhir.eu.laboratory#2.0.0` ainsi que ses dépendances directes (`eu.base`, `eu.extensions.r4`, `uv.xver-r5.r4`, `terminology.r4` et `uv.extensions.r4`).

Le canal **04 HL7v2 PID to FR Core INS** complète ces packages avec les ressources locales de [`demo/fhir-volume/04-hl7v2-pid-fr-core-ins`](../../../demo/fhir-volume/04-hl7v2-pid-fr-core-ins/) (modèle logique `PID`, map FML et terminologie INSEE).

## Ressource FHIR entrante et modèles logiques JSON (canaux 05 et 06)

- **Canal 05 (`10802/fhir-patient/`)** : reçoit un `Patient` FHIR R4 JSON, exécute la map de [`05-fhir-patient-normalization`](../../../demo/fhir-volume/05-fhir-patient-normalization/README.md) en mode **FHIR resource / Logical model** (`sourceModel=fhir`), met le nom de famille en majuscules, conserve l'identifiant INS-NIR et force `active: true`.
- **Canal 06 (`10803/commande-json/`)** : transforme un JSON métier `Commande` en `BonPreparation` à l'aide de deux `StructureDefinition` logiques ([`06-json-order-to-dispatch`](../../../demo/fhir-volume/06-json-order-to-dispatch/README.md)), avec la validation FHIR de sortie désactivée.

## FML R5, StructureMap JSON et terminologie externe (canaux 07, 08 et 14)

- **Canal 07 (`10814/permission-r5/`)** : transforme un CSV en `Bundle` R5 (`Organization` + `Permission`) avec [`CsvToPermissionR5.fml`](../../../demo/fhir-volume/07-csv-permission-r5/CsvToPermissionR5.fml), testé avec un [CSV nominal](../../../examples/csv/permissions-r5.csv) et un [CSV invalide](../../../examples/csv/permissions-r5-invalide.csv).
- **Canal 08 (`10815/patient-fml-ig/`)** : résout une `StructureMap` JSON publiée via `mapUrl` ([`StructureMap-OruR01ToPatientIG.json`](../../../demo/fhir-volume/08-oru-patient-structuremap/StructureMap-OruR01ToPatientIG.json)) et permet de la copier vers l'éditeur inline avec **Copy to inline map**.
- **Canal 14 (`10816/obs-external-tx/`)** : interroge le serveur terminologique Hades (`http://term-server:8500/fhir`) via le contexte `external-terminology` (`ConceptMap/$translate` : `GLU` → LOINC `14749-6`) et applique le repli `data-absent-reason#unknown` lorsque le code n'est pas trouvé.
