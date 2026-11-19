# Transformation FML

L'étape **FHIR FML Transform** est un second transformeur, à côté du FHIR Profile
Mapper. Elle offre une autre façon de produire des ressources conformes à des
profils FHIR : elle exécute une map écrite en
[FHIR Mapping Language](https://hl7.org/fhir/R4/mapping-language.html) (FML,
ressource `StructureMap`) sur le message, présenté sous la forme d'un modèle
générique OIE, d'un **modèle logique HL7 v2 typé**, ou d'une ressource FHIR,
puis publie le résultat. Une cible peut aussi être un modèle logique métier
non FHIR, comme dans l’[exemple commande JSON](../../../demo/fhir-volume/06-json-order-to-dispatch/README.md) ;
la validation FHIR de sortie doit alors être désactivée.

La map peut provenir d'un IG ou d'un dépôt, ou être écrite dans l'étape. L'éditeur
fournit coloration, complétion locale, contrôle de syntaxe et génération d'un
squelette à partir des modèles source et cible.

| | FHIR Mapper Transform | FHIR FML Transform |
|---|---|---|
| Où vit le mapping | Dans l'étape : règles JSON saisies dans l'éditeur | Hors de l'étape : fichiers FML |
| Langage | Expressions JavaScript/E4X | FML, expressions FHIRPath |
| Source | `msg` OIE | `OieMessage`, modèle logique HL7 v2 typé ou ressource FHIR |
| Exécution | JavaScript généré + runtime embarqué | Moteur FML du core HL7, en Java |
| Pour qui | Intégrateur OIE, saisie guidée sur l'arbre du profil | Équipe qui maintient ses transformations en FML |

Les deux étapes partagent la validation de FHIR Data Type et les emplacements de
profils. Elles coexistent ; la démo les montre côte à côte (§6).

## 1. L'étape

Classe `fr.kazepoy.fhir.fml.FhirFmlTransformStep`, nom affiché **FHIR FML Transform**.

| Propriété | Contrat |
|---|---|
| `context` | Nom d'un contexte FHIR du serveur : sa version et ses packages remplacent `fhirVersion` et `profiles`. Vide par défaut. |
| `fhirVersion` | `R4` par défaut, `R4B`, `R5` : version des ressources produites. |
| `profiles` | Fichiers et répertoires du serveur, séparés par `;` : maps (`.fml`, `.map`, `StructureMap` JSON/XML), profils, ConceptMaps, packages `.tgz`. |
| `mapSource` | Texte FML de la map, écrit dans l'onglet **Map** et enregistré avec le canal. S'il n'est pas vide, il est exécuté à la place de `mapUrl` ; il peut importer les maps des emplacements. |
| `mapUrl` | Canonique d'une `StructureMap` des emplacements. Obligatoire si `mapSource` est vide. |
| `sourceModel` | `fhir` par défaut (ressource FHIR entrante JSON/XML), `logical` (modèle logique XML/JSON désigné par `sourceModelUrl`) ou `oie-message` (enveloppe générique `OieMessage`). |
| `sourceModelUrl` | URL canonique de la `StructureDefinition` logique source lorsque `sourceModel` vaut `logical`. |
| `variable` | Vide : résultat principal ; sinon nom d'une variable de Channel Map. |
| `validateOutput` | Politique de validation du contexte local, `true` par défaut. |
| `validationOverride` | Booléen facultatif : surcharge la politique locale ou Settings pour cette étape. Absent/null : héritage du contexte. |
| `traceMessages` | `false` par défaut. Capture entrée, instance source, paramètres, sortie, diagnostics et durée dans `FML_TRACE_D<connectorId>_S<sequence>` de la Channel Map, y compris en cas d’erreur. |
| `sampleMessage` | Sample enregistré dans le step pour initialiser son onglet Test ; sans effet à l’exécution du canal. |
| `sampleFormat` | `xml`, `json` ou `raw` : entrée déjà préparée du sample ; vide : utiliser le datatype et les options du Summary. |
| `terminologyServer` | URL du serveur terminologique HAPI, vide pour les ressources locales ; héritée lorsqu’un contexte Settings est choisi. |
| `terminologyAuthorization` | Expression JavaScript de l’en-tête Authorization ; valeur résolue exclue des traces. |
| `cacheSeconds`, `timeoutSeconds` | Cache des réponses HAPI (300 s, 0 pour désactiver) et délai HTTP (10 s), locaux ou hérités du contexte. |
| `contextVariables` | Noms de variables OIE (`$`) copiées dans `context.variable` du modèle, séparés par des virgules. |

À l'exécution, le script de l'étape :

1. lit le message : XML interne d'OIE (`msg.toXMLString()`, pour HL7 v2, délimité,
   XML…), JSON, ou texte ;
2. ajoute le contexte : `channelId`, `channelName`, `messageId`, `connectorName`,
   `receivedDate`, et les variables demandées ;
3. exécute la map ;
4. si `validateOutput`, valide le résultat avec FHIR Data Type, contre les profils
   de son `meta.profile` ou sa définition de base. Un résultat invalide arrête
   le message avec la liste des erreurs ;
5. publie comme le Mapper Transform : le modèle de sortie `tmp` (XML FHIR, texte ou
   objet JSON) s'il existe, sinon `msg`, ou la variable de Channel Map.

Une map inconnue, une erreur de la map ou une erreur de lecture du message
arrêtent aussi le message, avec le nom de l'étape et de la map.

Les maps sont lues une fois par combinaison de version FHIR et d'emplacements,
puis gardées en mémoire. Elles sont relues au déploiement d'un channel qui
contient une étape FML, à chaque déploiement global, et par le bouton **Reload**
de l'éditeur.

## 2. Modèles sources

Pour comprendre la différence entre `msg` natif OIE, OieMessage et un modèle
logique spécifique, consulter [Données OIE et modèles sources FML](../../fr/architecture/Representations-sources.md).
OieMessage appartient au plugin ; le Mapper Transform ne passe pas par ce modèle.

### 2.1 Modèle logique OIE

`http://oie.org/fhir/StructureDefinition/OieMessage`
([StructureDefinition](../../../src/main/resources/fr/kazepoy/fhir/fml/bridge/StructureDefinition-OieMessage.json),
canonique provisoire). Un **seul modèle** pour tous les types de messages : il
reflète l'arbre XML interne d'OIE, celui que voit E4X, ou l'arbre d'un JSON. La
map trouve un nœud par son **nom** ou sa **position**.

```text
OieMessage                       le message : son nœud racine et son contexte
├── context
│   ├── channelId, channelName, messageId, connectorName, receivedDate
│   ├── dataType                 HL7V2, DELIMITED, XML, JSON ou RAW, déduit du message
│   └── variable 0..*  { name, value }
├── name                         nœud racine : HL7Message, delimited, élément XML racine
├── value                        texte d'un message sans nœuds (RAW)
├── attribute 0..*  { name, value }
└── node 0..*                    nœuds enfants, récursifs
    ├── name        string       PID, PID.5, PID.5.1, élément XML, clé JSON
    ├── position    integer      nombre qui termine le nom (5 pour PID.5),
    │                            sinon rang parmi les frères, à partir de 1
    ├── occurrence  integer      rang parmi les frères de même nom, à partir de 1 :
    │                            répétition d'un champ, n-ième OBX
    ├── value       string       texte d'un nœud sans enfants
    ├── attribute 0..*
    └── node 0..*
```

Exemple : `PID|1||100001^^^EXAMPLE^PI||MARTIN^CLAIRE^ANNE^^Mme^^L` donne

| Nœud | `name` | `position` | `occurrence` | `value` |
|---|---|---|---|---|
| segment | `PID` | 2 (après MSH) | 1 | |
| champ | `PID.5` | 5 | 1 | |
| composant | `PID.5.1` | 1 | 1 | `MARTIN` |
| composant | `PID.5.2` | 2 | 1 | `CLAIRE` |

Particularités du XML HL7 v2 d'OIE, reprises telles quelles :

- les champs vides intermédiaires sont présents (`PID.2` sans `value`) ;
- un champ contient toujours ses composants : le sexe est `PID.8` → `PID.8.1` ;
- un sous-composant n'apparaît que s'il existe (`PID.3.4` porte directement
  `EXAMPLE`, sans `PID.3.4.1`) ;
- les segments sont à plat, sans groupes ; un OBX se distingue par son
  `occurrence`.

Pour un JSON, chaque propriété est un nœud (`name` = clé) ; un tableau donne un
nœud par élément, de même nom, avec son `occurrence`.

Le modèle de l'instance reçue par une map pour un message donné est visible dans
l'onglet Test de l'éditeur et par `POST /source` (§4).

### 2.2 Modèle logique (`logical`)

Le mode `logical` parse directement du XML ou du JSON non FHIR à l'aide du
lecteur natif du core HL7 (`parser.setLogical(definition)`), selon la
`StructureDefinition` logique désignée par `sourceModelUrl` :

- pour du **XML HL7 v2 Strict Parser** (canal `04`), les éléments de la SD
  utilisent les annotations FHIR standard (`xml-name` pour faire correspondre
  `PID.3` à `PID_3`, et `xmlText` pour le contenu textuel) ;
- pour du **JSON métier sans `resourceType`** (canal `06`), l'extension
  `json-suppress-resourcetype` permet de lire directement l'objet métier selon
  le modèle logique.

### 2.3 Ressource FHIR entrante

Le mode `fhir` parse directement une ressource FHIR JSON ou XML dans la version
du contexte. La map peut donc déclarer par exemple `Patient` comme source, sans
l'envelopper dans `OieMessage`. `sourceModelUrl` n'est pas utilisé dans ce mode.

### Exemple de map

Extrait de la [map de démo](../../../src/test/resources/fml/OruR01ToPatient.fml) :

```fml
map "http://example.org/fhir/oru2fhir/StructureMap/OruR01ToPatient" = "OruR01ToPatient"

uses "http://oie.org/fhir/StructureDefinition/OieMessage" alias OieMessage as source
uses "http://example.org/fhir/oru2fhir/StructureDefinition/ExampleLabPatient" alias Patient as target

group OruR01ToPatient(source src : OieMessage, target patient : Patient) {
  src.node as pid where name = 'PID' then {
    pid.node as xpn where name = 'PID.5' -> patient.name as name then {
      xpn.node as family where position = 1 then { family.value as v -> name.family = v "family"; } "family-name";
      xpn.node as given where position = 2 then { given.value as v -> name.given = v "given"; } "given-name";
      xpn.node as type where position = 7 and value = 'L' -> name.use = 'official' "use-official";
    } "name";
    pid.node as sex where name = 'PID.8' then {
      sex.node as code where position = 1 then {
        code.value as v -> patient.gender = translate(v, 'http://example.org/fhir/oru2fhir/ConceptMap/v2-0001-to-gender', 'code') "gender";
      } "sex-code";
    } "sex";
  } "pid";
}
```

Le groupe d'entrée a **un seul paramètre source** (le moteur n'en accepte pas
plusieurs) : le contexte est donc dans le modèle (`src.context`), pas dans un
second paramètre. `translate()` utilise les ConceptMaps des emplacements de
l'étape. Les maps peuvent en importer d'autres (`imports`), créer des ressources
(`create('Observation')`) et des types choix (`value = create('Quantity')`).

## 3. Architecture

### 3.1 Choix : le core HL7 de FHIR Data Type, sans Matchbox

FHIR Data Type 1.6.1 installe HAPI 8.12.1 et le core HL7 **6.9.12**, qui contient
le moteur FML (`StructureMapUtilities`). L'étape l'utilise directement, à
travers le contexte de validation du datatype : aucun JAR tiers n'est ajouté.

[Matchbox](https://github.com/ahdis/matchbox) a été écarté pour trois raisons :

- il embarque ≈ 61 Mo de packages FHIR ;
- il **remplace des classes du core** sous le même nom (`StructureMapUtilities`,
  `elementmodel.Element`, `XmlParser`, `Property`, `BaseWorkerContext`…) et cible une
  autre version du core : il exigerait un chargeur isolé avec une
  seconde copie complète de HAPI et du core ;
- le core 6.9.12 de FHIR Data Type couvre directement nos besoins (`OieMessage`,
  modèle logique XML/JSON via `StructureDefinition`, modèle HL7 v2 Strict Parser,
  ressource FHIR et types choix), avec des services légers (`OieTransformerServices`,
  sous licence MPL 2.0, d'après `TransformSupportServices` Apache 2.0).

Le contexte et les maps sont partagés en lecture avec verrouillage par clé de
contexte, tandis que les objets d'exécution mutables sont créés par requête (§8).

### 3.2 Code

Le code est dans un package dédié, séparé du Mapper Transform :

| Package | Rôle | JAR |
|---|---|---|
| `fr.kazepoy.fhir.fml` | `FhirFmlTransformStep` (script de l'étape), `FmlFacade` (exécution et validation), `FmlServletInterface` | serveur |
| `fr.kazepoy.fhir.fml.integration` | `FmlBridgeAdapter` : charge le pont avec le chargeur de FHIR Data Type et l'appelle par réflexion, avec des `String` et des `Map` | serveur |
| `fr.kazepoy.fhir.fml.server` | `FmlServlet`, `FmlTester`, `FmlServicePlugin` (sérialisation, permissions), `FmlChannelPlugin` (relecture des maps au déploiement) | serveur |
| `fr.kazepoy.fhir.fml.bridge` | Le moteur, côté HAPI | `lib/fhir-fml-bridge.jar` |

Le pont (`fr.kazepoy.fhir.fml.bridge`) :

| Classe | Rôle |
|---|---|
| `FmlBridge` | Point d'entrée : `listMaps`, `source`, `transform`, `clearCaches`. Résout la cible depuis le paramètre cible du premier groupe (le `getTargetType` du core refuse une map qui déclare plusieurs cibles). |
| `FmlContext` | Chaîne de validation HAPI du datatype (spécification, profils) exposée en `IWorkerContext` R5 par `WorkerContextValidationSupportAdapter` ; lecture des maps (`.fml`, `.map`, `StructureMap`, packages) et des ConceptMaps. |
| `FmlResources` | Sert au moteur les `StructureMap` (pour les `imports`), les `ConceptMap` (pour `translate()`) et le modèle `OieMessage`, que `PrePopulatedValidationSupport` ne conserve pas. |
| `FmlSourceBuilder` | Choisit le builder `fhir`, `logical` ou `oie-message`. |
| `OieModelBuilder` | Construit directement l'arbre `Element` générique à partir du XML d'OIE ou du JSON. |
| `OieTransformerServices` | `ITransformerServices` : création des types et des ressources de la cible. |

La sortie est sérialisée par l'`elementmodel` du core : elle suit la forme de la
version des définitions (R4 pour la démo), dans l'ordre des définitions, avec
les décimaux tels quels (`5.10`).

## 4. API

Sous `/api/extensions/fhir-fml`, avec l'authentification OIE, `X-Requested-With:
OpenAPI` et des corps `text/plain` :

| Route | Permission | Rôle |
|---|---|---|
| `GET /maps?fhirVersion&profiles` | Edit FHIR FML transforms | `{"maps": [{url, name, title}], "errors": {fichier: message}}` |
| `POST /source` | Edit FHIR FML transforms | Instance source d'un message ; accepte aussi `sourceModel` et `sourceModelUrl`. |
| `POST /check` | Edit FHIR FML transforms | Analyse une map écrite dans l'étape : `{"mapSource", "fhirVersion", "profiles"}` → `{"url", "name", "groups", "errors": [{line, column, message}]}` ; signale aussi les `uses` et `imports` absents des emplacements |
| `POST /reload` | Edit FHIR FML transforms | Oublie les maps chargées : elles sont relues au prochain appel |
| `POST /test` | Test FHIR FML transforms | `{"step", "message", "dataType"}` → `{"model", "output", "validationPerformed", "issues", "errors": [{phase, message}]}` |

Les phases d'erreur du test sont `configuration`, `input`, `transform` et
`validation`. Les permissions sont déclarées par le plugin et appliquées par un
plugin d'autorisation comme RBAC.

## 5. Éditeur

[editor.js](../../../webadmin/src/fml/editor.js), trois onglets principaux :

- **Properties** : organisées en quatre sections (**FHIR context**, **1 Source**, **2 Map**, **3 Destination**) : contexte Settings ou local (version FHIR, packages, serveur de terminologie et politique de validation), modèle source (`FHIR resource / Logical model` ou `Generic OIE message`, voire `Typed HL7 v2 logical model` lorsqu'une étape existante l'utilise), map choisie parmi celles chargées (**Load maps**, **Reload**, **Copy to inline map**), variables de contexte, destination du résultat, validation et trace ;
- **Map** : la map de l'étape dans l'éditeur de code de Web Admin, en langage `fml`.
  La complétion propose mots-clés, transformations, fonctions FHIRPath, aliases
  `uses`, groupes, variables et chemins de profil déjà chargés. **Check** souligne
  les erreurs de syntaxe et les `uses`/`imports` absents. Le générateur demande une
  cible, crée les `uses`, le groupe principal et des TODO pour ses éléments requis.
  **Clear** revient à la map choisie dans Properties ;
- **Test** : organisé en quatre sous-onglets (**Sample**, **FML source**, **Result**, **Validation**), avec choix du format du sample (entrée du canal reprenant le datatype et les options du Summary, ou XML/JSON/texte préparé), option **Format** et bouton **Run test**.

## 6. Démo

Les canaux `01` à `08`, `11` et `17` de la [démo active](../../fr/demo/Demo.md) illustrent FML :

- **01 ADT A28 to Patient - Inline FML** (port 10804, `/simple-fml`) : map FML écrite dans l'étape (`mapSource`), sur XML HL7 v2 natif (`OieMessage`).
- **02 ADT A28 to Patient - Terminology** (port 10805, `/fml-terminology`) : contexte Settings `patient-r4`, serveur terminologique Hades (`:8500`), imports FML imbriqués et traces `FML_TRACE_D2_S0` / `FML_TRACE_D2_S1`.
- **03 HL7v2 to Patient - OieMessage** (port 10800, `/oru-patient`) : cinq destinations comparant HL7 v2 standard, Strict Parser et entrées préparées XML, JSON et texte.
- **04 HL7v2 PID to FR Core INS** (port 10801, `/pid-fr-core-ins`) : XML HAPI Strict Parser, modèle logique PID et profil cible FR Core INS Patient.
- **05 FHIR Patient - Normalize Identity** (port 10802, `/fhir-patient`) : ressource FHIR entrante (`sourceModel=fhir`).
- **06 JSON Order to Dispatch** (port 10803, `/commande-json`) : deux modèles logiques métier JSON non FHIR.
- **07 CSV to R5 Permission - FML** (port 10814, `/permission-r5`) : CSV vers Bundle transaction R5 (`Organization` + `Permission`).
- **08 ORU to Patient - StructureMap** (port 10815, `/patient-fml-ig`) : `StructureMap` JSON publiée, appelée par `mapUrl`.
- **11 HL7v2 to Patient - IG tgz** (port 10808, `/devdays-patient`) : package IG `.tgz` (`DevDaysIGtutorial-Patient`) et terminologie Hades.
- **17 ORU to Patient - FML vs Mapper** (port 10817, `/patient-compare`) : comparaison parallèle FML inline vs Mapper Transform sur la même entrée HL7 v2.

## 7. Tests

| Test | Ce qu'il vérifie |
|---|---|
| [FmlBridgeTest](../../../src/test/java/fr/kazepoy/fhir/fml/bridge/FmlBridgeTest.java) | Modèle OIE, source FHIR, modèle HL7 v2 typé, maps importées, Bundle transaction et 24 transformations génériques/typées concurrentes sans contamination |
| [FhirFmlTransformStepTest](../../../src/test/java/fr/kazepoy/fhir/fml/FhirFmlTransformStepTest.java) | Script exécuté dans Rhino avec E4X, publication dans `msg` ou une variable, échec d'une map inconnue, test sur message exemple, map de démo valide contre `ExampleLabPatient`, sérialisation XML du channel |
| [fml-transform.test.js](../../../webadmin/test/unit/fml-transform.test.js) | Enregistrement et valeurs par défaut de l'étape dans l'administration web |
| [fml-completion.test.js](../../../webadmin/test/unit/fml-completion.test.js) | Complétion locale et squelette avec éléments cibles requis |

Les fixtures sont dans `src/test/resources/fml/` : deux maps et un ORU sérialisé
par OIE.

## 8. Limites

- **Canonique du modèle** `http://oie.org/fhir/StructureDefinition/OieMessage` : canonique interne du modèle générique `OieMessage`.
- **Concurrence** : le contexte et les maps chargées sont partagés en lecture (avec verrouillage par clé lors de la construction initiale) ;
  chaque appel crée ses services, son `StructureMapUtilities`, sa source et sa
  cible. Un test unitaire exécute 24 transformations concurrentes sur 8 threads sans contamination.
- **Mémoire** : les contextes sont gardés jusqu'au prochain déploiement global
  ou rechargement.
- **Pas de trace par règle** ni de diagnostic relié à une règle FML : les erreurs
  portent le message du moteur, l'étape et la map.
- **Check n'est pas un analyseur sémantique complet** : le core 6.9.12 contrôle
  la syntaxe, les `uses` et les `imports`, mais son analyse statique rejette à tort
  certains aliases logiques. Les chemins sont donc vérifiés définitivement à
  l'exécution sur un exemple.
- **Pas de Bundles partagés** avec le Mapper Transform : une map FML produit sa
  propre ressource, Bundle compris.
- `resolveReference` et `performSearch` ne sont pas pris en charge ; une
  ConceptMap absente des emplacements fait échouer `translate()`.
- Fonctions d'aide éventuelles (dates HL7 v2, accès par chemin positionnel) :
  non implémentées ; les maps utilisent FHIRPath (`substring`, `where`).
