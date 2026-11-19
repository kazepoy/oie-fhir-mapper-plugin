# Démo OIE

## Présentation

La démonstration contient **dix-sept canaux** répartis dans deux groupes natifs OIE (**FML transformer** et **Mapper transformer**), avec des tags par format d'entrée (`hl7v2`, `fhir`, `json`, `csv`, `xml`), type de transformation (`fml`, `mapper`), version (`r5`) et terminologie (`termino`). Le [catalogue des canaux](../../../demo/oie-init/README.md) et le fichier [examples.json](../../../demo/oie-init/examples.json) listent les entrées HTTP, les samples et l'apport de chaque parcours.

- [demo/fhir-volume](../../../demo/fhir-volume/README.md) est monté dans `/fhir-volume` : ressources par exemple et profils laboratoire partagés (`/fhir-volume/shared/lab-r4`) ;
- [demo/oie-init](../../../demo/oie-init/README.md) est monté dans `/oie-init` : configuration serveur, canaux `01` à `17`, groupes, samples et contextes *Settings › FHIR Mapper* ;
- [demo/term-server](../../../demo/term-server/README.md) fournit le serveur terminologique Hades sur le port **8500**.

## Environnement

L'environnement Docker Compose déploie :

- Open Integration Engine **4.7.0** et PostgreSQL **18.3** ;
- Web Support **1.3.0**, avec l'administration web **1.3.0** ;
- FHIR Data Type **1.6.1** ;
- [Role Based Access Control](https://github.com/diridium-com/role-based-access-control) **1.3.0** (diridium-com) ;
- [OIE Flow UI](https://github.com/kazepoy/oie-flow-ui-plugin) **0.9.0** (Flows Monitoring, Channel Flow) ;
- FHIR Mapper **0.1.0-SNAPSHOT**, compilé depuis les sources du projet, avec ses deux étapes : [FHIR Mapper Transform](../../fr/reference/Mappeur-graphique.md) et [FHIR FML Transform](../../fr/reference/Transformation-FML.md).

Web Support, FHIR Data Type, RBAC, Flow UI et les packages [FR Core 2.2.0](https://hl7.fr/ig/fhir/core/2.2.0/) et [HL7 Europe Laboratory 2.0.0](https://hl7.eu/fhir/laboratory/2.0.0/) sont téléchargés au build avec vérification de leur SHA-256.

La configuration définit dans *Settings › FHIR Mapper* les contextes partagés (`patient-r4`, `demo-labo`, `fr-core-2.2.0`, `eu-laboratory-2.0.0`, `external-terminology`, `demo-r5`).

## Les 17 canaux de démonstration

La [matrice des exemples](Matrice-exemples.md) et le [détail des parcours JSON, R5 et FML](JSON-FR-Core-et-FML.md) complètent le tableau ci-dessous :

| Canal | Groupe | Port et route | Capacités illustrées |
|---|---|---|---|
| **01 ADT A28 to Patient - Inline FML** | FML transformer | `10804/simple-fml/` | ADT A28 → Patient, FML inline sur XML natif OIE (`OieMessage`), sans étape JavaScript préalable. |
| **02 ADT A28 to Patient - Terminology** | FML transformer | `10805/fml-terminology/` | Contexte Settings `patient-r4`, serveur terminologique Hades (`:8500`), imports FML imbriqués et traces `FML_TRACE_D2_S0` / `S1`. |
| **03 HL7v2 to Patient - OieMessage** | FML transformer | `10800/oru-patient/` | Cinq destinations indépendantes comparant HL7 v2 standard, Strict Parser et entrées préparées XML, JSON et texte avec `OieMessage`. |
| **04 HL7v2 PID to FR Core INS** | FML transformer | `10801/pid-fr-core-ins/` | XML HAPI du Strict Parser, modèle logique `PID` et profil cible `FRCorePatientINSProfile`. |
| **05 FHIR Patient - Normalize Identity** | FML transformer | `10802/fhir-patient/` | Ressource FHIR entrante (`sourceModel=fhir`) : normalisation d'identité, nom en majuscules et `active=true`. |
| **06 JSON Order to Dispatch** | FML transformer | `10803/commande-json/` | Transformation entre deux modèles logiques métier JSON non FHIR (`Commande` → `BonPreparation`), sans validation FHIR de sortie. |
| **07 CSV to R5 Permission - FML** | FML transformer | `10814/permission-r5/` | Entrée CSV (`DELIMITED`) vers Bundle transaction FHIR R5 (`Organization` + `Permission`). |
| **08 ORU to Patient - StructureMap** | FML transformer | `10815/patient-fml-ig/` | `StructureMap` JSON publiée sur le serveur, exécutée par `mapUrl` et copiable vers l'éditeur inline. |
| **09 CSV to Patient Bundle - Mapper** | Mapper transformer | `10806/csv-patients-collection/` | Nettoyage CSV en source puis construction d'un Bundle `collection` de dix Patients en destination (accents et zéros initiaux préservés). |
| **10 ORU to Lab Bundle - Mapper** | Mapper transformer | `10807/oru/` | Bundle `transaction` clinique à sept étapes Mapper Transform, itérations d'observations, références typées (`fhirRef`), traductions ConceptMap et trace des messages traités (`fhirMapperTrace`). |
| **11 HL7v2 to Patient - IG tgz** | FML transformer | `10808/devdays-patient/` | ADT A28 → `DevDaysIGtutorial-Patient` à partir d'un package IG `.tgz` et du serveur terminologique Hades. |
| **12 ORU to Two Lab Bundles - Mapper** | Mapper transformer | `10811/labo/` | Construction simultanée de deux Bundles (`transaction` et `document`) partageant les mêmes ressources cliniques, sortie en variable (`bundleDocument`) et archivage conditionnel. |
| **13 SQL XML to Patient - Mapper** | Mapper transformer | `10812/sql-patient/` | Ligne XML de résultat SQL vers `ExampleLabPatient`, conservation des accents et des zéros initiaux de l'IPP. |
| **14 JSON to Obs Ext TX - Mapper** | Mapper transformer | `10816/obs-external-tx/` | Traduction terminologique distante via `ConceptMap/$translate` (contexte `external-terminology`), repli sur code inconnu et erreur HTTP 503. |
| **15 Terminology Mock ($translate)** | Mapper transformer | `10819/fhir/` | Mock HTTP OIE implémentant `GET /fhir/ConceptMap/$translate` pour le canal 14. |
| **16 JSON to R5 Org - Mapper** | Mapper transformer | `10810/organization-r5/` | JSON métier vers `Organization` FHIR R5, avec le champ `description` de type `markdown` propre à R5. |
| **17 ORU to Patient - FML vs Mapper** | Mapper transformer | `10817/patient-compare/` | Deux destinations parallèles (FML inline vs Mapper Transform) sur la même entrée HL7 v2, vérifiant l'égalité des sorties (`OUTPUTS_EQUAL=true`) et mesurant `FML_MS`, `MAPPER_MS` et `DIFF_MS`. |

## Lancer la démonstration

Docker avec Compose **2.23.1 ou ultérieur** est nécessaire. Depuis la racine du projet :

```sh
cd demo
docker compose up -d --build
docker compose logs oie-init
```

Administration : <https://localhost:8443/oie-webadmin/> (certificat autosigné, compte `admin`, mot de passe `admin`).

Dans *Settings > Extensions*, vérifier la présence de Web Support, FHIR Data Type, Role-Based Access Control, Flow UI et FHIR Mapper. Le journal OIE contient `FHIR Mapper started.` et `FHIR FML Transform started.`.

Les réglages sont dans [compose.yaml](../../../demo/compose.yaml) (personnalisables via [demo/.env.example](../../../demo/.env.example)). Les ports `8443`, `8500` et `10800` à `10900` doivent être disponibles.

## Rejouer et vérifier les exemples

Les contrôles hors ligne et les tests de bout en bout (API, canaux déployés et parcours navigateur Playwright) se lancent depuis la racine :

```sh
# Validation hors ligne des schémas et samples des 17 canaux
node tools/run_tests.mjs --offline demo/oie-init/data/channels

# Suite E2E complète sur la démo démarrée
npm --prefix webadmin run test:e2e
```

Voir également le [guide de rejeu](Rejeu-tests.md).

## Réinitialiser la démo

Pour restaurer la configuration serveur, les contextes, les groupes et les 17 canaux à leur état initial :

```sh
cd demo
docker compose run --rm oie-init
```

```sh
docker compose stop  # arrêter en conservant les conteneurs et les données
docker compose down  # retirer les conteneurs ; les volumes restent conservés
```
