# Données OIE, OieMessage et modèles sources FML

[Architecture](README.md) · [Manuel FML](../../fr/user-manual/fml/README.md)

**OieMessage est un modèle générique du plugin, pas le format interne d’OIE.**
Le Mapper Transform utilise directement le message OIE ; le FML Transform le
présente au moteur FML sous un modèle décrit par une StructureDefinition.
OieMessage est l’un des modèles possibles.

## Trois notions à distinguer

| Notion | Rôle | Qui la définit ? |
|---|---|---|
| Message courant `msg` | Données disponibles à l’entrée du step : XML/E4X, objet JSON ou texte | OIE et les steps précédents |
| Modèle source FML | Structure que les règles FML peuvent parcourir | Une StructureDefinition chargée par le moteur FML |
| Vue JSON « FML source » | Affichage de l’instance effectivement remise à la map | Le plugin, dans l’onglet Test |

Le JSON affiché dans Test n’est donc pas une preuve que le message courant OIE
était du JSON. Une entrée XML peut être affichée sous forme JSON après sa
conversion vers le modèle source FML.

## Ce que fait chaque transformeur

**FHIR Mapper Transform** évalue des expressions JavaScript sur `msg`.
Après parsing HL7 v2 standard, une expression peut lire directement :

```javascript
msg['PID']['PID.5']['PID.5.1'].toString()
```

Il ne construit pas d’OieMessage. Les chemins dépendent toujours du parseur et
des steps précédents : le XML du Strict Parser a d’autres groupes et composants.

**FHIR FML Transform** utilise un moteur qui parcourt des instances décrites
par des StructureDefinition. Il ne lui transmet pas directement l’objet E4X
OIE. L’interface propose trois choix : **FHIR resource** (`fhir`), **Logical model** (`logical`, avec sélection de la `StructureDefinition` logique), et **Generic OIE message** (`oie-message`) :

| Mode source | Préparation de l’entrée | Contrat de la map |
|---|---|---|
| `fhir` | Lecture FHIR XML ou JSON directe par le core HL7 | Ressource FHIR standard ou profilée, sans enveloppe OieMessage |
| `logical` | Lecture XML ou JSON directe selon la SD logique choisie (`sourceModelUrl`), y compris `xmlText` et les noms XML déclarés | Modèle logique spécifique, sans enveloppe OieMessage |
| `oie-message` | Conversion de l’arbre XML ou JSON, ou du texte, vers OieMessage | Modèle générique `node`, `name`, `value` |

OieMessage est lui-même un modèle logique : « générique » et « logique » ne
s’opposent pas. La distinction porte sur un modèle d’arbre générique ou un
modèle décrivant des données précises.

## La conversion vers OieMessage

Pour une entrée XML, le plugin sérialise le `msg` XML/E4X, lit le XML en Java,
puis parcourt récursivement ses éléments. Il construit une instance du modèle
[OieMessage](../../../src/main/resources/fr/kazepoy/fhir/fml/bridge/StructureDefinition-OieMessage.json).
Un élément devient un nœud avec son nom, ses enfants, ses attributs et sa valeur
textuelle s’il est une feuille. Le plugin ajoute le contexte OIE demandé.

Exemple simplifié, sans les positions, occurrences et métadonnées :

```xml
<PID><PID.5><PID.5.1>MARTIN</PID.5.1></PID.5></PID>
```

```json
{
  "name": "PID",
  "node": [{
    "name": "PID.5",
    "node": [{ "name": "PID.5.1", "value": "MARTIN" }]
  }]
}
```

Pour JSON, les propriétés deviennent des nœuds et les éléments d’un tableau
créent des occurrences. Pour du texte, le contenu reste dans `value` : un ORU
ER7 brut ou un CSV brut n’est pas découpé automatiquement par OieMessage.
Le parsing du datatype intervient avant cette conversion.

Cette conversion ne reconnaît pas le sens métier du PID. Elle ne rend pas
identiques les structures standard et strictes. Elle n’est pas non plus une
copie sans perte de tout XML/JSON : les espaces de noms XML ne sont pas conservés
comme identifiants, le texte mixte avec des éléments enfants n’est pas conservé,
et les valeurs JSON primitives sont représentées comme du texte. Il ne faut
pas utiliser OieMessage comme format d’archivage permettant de reconstruire
l’original à l’identique.

## OieMessage est-il réservé aux cas simples ?

**Non : il peut représenter un arbre complexe, avec groupes et répétitions.**
Il sert lorsque l’on veut écrire une FML sans définir au préalable un modèle
source métier spécifique.

La difficulté grandit cependant avec la map : accès par noms de nœuds,
expressions plus longues, dépendance à la structure du parseur, types et
cardinalités métier non décrits par le modèle générique. Le fait d’avoir
construit un OieMessage ne prouve pas que l’entrée est un ORU complet ou conforme.

| Besoin | Choix possible et compromis |
|---|---|
| Quelques données à extraire, pas de modèle source disponible | OieMessage évite de créer un modèle spécifique |
| Arbre complexe sans modèle source | OieMessage reste possible ; évaluer la lisibilité et tester groupes, répétitions et absences |
| Contrat métier stable, maps maintenues et réutilisées | Un modèle logique spécifique rend les propriétés explicites, au prix de sa définition et de sa maintenance |
| Source déjà FHIR | Le mode `fhir` utilise le modèle existant de la ressource |
| Accès direct au message OIE avec des expressions JavaScript | Mapper Transform utilise `msg` directement |

La taille du message ne suffit donc pas pour choisir : il faut considérer le
contrat d’entrée, la complexité des règles et le coût de maintenance du modèle.

## Place des deux transformeurs

L’orientation retenue pour la réflexion sur le plugin est la suivante. Elle ne
signifie pas que tous les lecteurs de modèles envisagés sont déjà implémentés.

| Parcours | Place privilégiée | Contrepartie |
|---|---|---|
| Mapper Transform | Intégration directe dans un channel OIE, avec expressions sur le message courant et sans modèle logique source à créer | Les expressions dépendent d’OIE et de la représentation de `msg` |
| FML avec modèle spécifique | Transformations fondées sur un contrat explicite, partageables et versionnées avec un IG | Il faut disposer du modèle et d’une lecture de l’entrée conforme à ce modèle |
| FML avec OieMessage | Solution de repli pour explorer, prototyper ou transformer sans modèle source métier spécifique | Les règles parcourent un arbre générique et dépendent de sa structure |

Cette répartition ne signifie pas « mappeur pour le simple, FML pour le
complexe ». Elle distingue une transformation intégrée à OIE d’une transformation
dont le contrat et les règles sont portés par des ressources partageables.

Pour la FML, privilégier les modèles FHIR existants lorsque la source est déjà
FHIR ; pour une source non FHIR stable, définir ou réutiliser un modèle logique
spécifique. OieMessage reste une solution valide, mais sa commodité ne doit pas
en faire par défaut le contrat métier de référence. Il possède lui aussi une
StructureDefinition : c’est le caractère générique de cette définition qui
limite l’expression du contrat métier, pas une absence de modèle.

## Portabilité : les ressources et la lecture de l’entrée

**Une transformation décrite par ses modèles et ses FML doit pouvoir être
transportée vers un moteur compatible.** Fournir l’ensemble de ses dépendances :

- modèles sources et définitions FHIR nécessaires, avec leurs versions ;
- FML ou StructureMap, y compris les maps importées ;
- profils cibles et leurs dépendances ;
- ConceptMaps, ValueSets, CodeSystems et services terminologiques utilisés ;
- services de support requis par les règles, par exemple la recherche de
  ressources ou la résolution de références.

Ces éléments portent le contrat et les règles de la transformation. Le moteur
cible doit prendre en charge les fonctions FML/FHIRPath utilisées et disposer
des services nécessaires. La disponibilité effective de ces dépendances doit
être vérifiée, pas seulement celle du fichier FML principal.

Il reste une frontière distincte : **fournir au moteur une instance source
correspondant au modèle**. Une StructureDefinition décrit la structure attendue ;
elle ne constitue pas à elle seule un parseur de message ER7 ou de toute
représentation XML particulière. La [spécification FML, section Executing Maps](https://hl7.org/fhir/R4/mapping-language.html),
laisse la forme concrète des instances à l’API du moteur et de l’application
hôte, et décrit les services de support permettant la portabilité.

| Ce que l’on fournit aux moteurs | Ce qui doit être assuré |
|---|---|
| Une instance source équivalente, conforme au même modèle, et toutes les ressources de transformation | La même FML doit pouvoir s’exécuter sur les moteurs compatibles, sans réécriture des règles métier |
| Le même message brut et les ressources de transformation | Chaque environnement doit aussi produire une instance source équivalente par son parsing et son adaptation |

Dans notre plugin, l’adaptateur entre le XML OIE et le modèle logique HL7 v2
appartient à cette couche d’entrée. Il n’est pas transporté par le seul package
contenant les SD et les FML. Un autre environnement peut utiliser son propre
lecteur, à condition de respecter le même contrat d’instance source.

L’objectif d’architecture est donc de **garder l’adaptation OIE à la frontière
et les règles métier dans les FML**, afin qu’un changement de moteur ne demande
pas de réécrire ces règles. Une map qui référence des noms issus d’un parseur
particulier reste liée à ce contrat : il faut le documenter et le reproduire,
ou adopter un modèle source plus indépendant du parseur.

Cela ne justifie ni de promettre une exécution automatique sur tout moteur,
ni de considérer la FML comme intrinsèquement liée à OIE. Pour démontrer la
portabilité d’un jeu de maps, exécuter les mêmes cas représentatifs sur un
second moteur, avec des instances sources équivalentes et des résultats
attendus comparables, notamment pour les répétitions, les valeurs absentes et
les traductions terminologiques. Cette comparaison entre moteurs n’est pas
encore démontrée par les cinq destinations de la démo : elles utilisent le même
moteur FML.

## XML, JSON et HL7 v2 : ce qui est disponible

Un XML ou JSON dont la structure est connue peut être décrit par un modèle
logique spécifique. Mais son format seul ne fournit ni ses types métier ni ses
cardinalités. Un même contrat peut servir de base aux deux représentations si
leurs lecteurs les associent correctement au modèle.

**Logical model lit le XML ou le JSON selon la StructureDefinition sélectionnée dans les propriétés de l’étape.** L’[exemple commande JSON](../../../demo/fhir-volume/06-json-order-to-dispatch/README.md)
transforme deux modèles logiques métier non FHIR, sans champ `resourceType`.
L’[exemple Normalize Patient identity](../../../demo/fhir-volume/05-fhir-patient-normalization/README.md)
utilise quant à lui le mode `fhir` et les modèles FHIR existants.

Pour HL7 v2, le Strict Parser produit des groupes et composants typés HAPI. Un
modèle logique spécifique doit correspondre à cette structure. L’adaptateur
actuel contient aussi un traitement de segments plats, qui ne dispense pas de
vérifier la correspondance avec le modèle choisi.

**Activer Strict Parser ne sélectionne pas automatiquement un modèle logique
typé.** Dans la démo actuelle, la destination stricte utilise OieMessage et une
FML adaptée aux noms HAPI. Les destinations XML et JSON préparés utilisent elles
aussi OieMessage ; elles ne démontrent pas un lecteur de modèle métier typé.

## Vérifier le message réellement reçu

Un step précédent peut remplacer le XML par du JSON ou du texte. Le Summary
décrit le parsing initial du transformeur, pas nécessairement le `msg` reçu par
chaque step.

Dans Test, **Entrée du canal** applique le datatype et ses options. **XML, JSON
ou texte préparé** fournit directement la forme reçue par la FML. Aucun de ces
modes ne rejoue les steps précédents. Examiner ensuite **FML source** et comparer
le résultat attendu ; rejouer le canal pour vérifier l’enchaînement réel.

Voir [le test d'une transformation FML](../../fr/user-manual/fml/tester.md).

## Repères dans le code

- [FhirFmlTransformStep](../../../src/main/java/fr/kazepoy/fhir/fml/FhirFmlTransformStep.java) : lit la représentation courante de `msg` et appelle le moteur.
- [FmlSourceBuilder](../../../src/main/java/fr/kazepoy/fhir/fml/bridge/FmlSourceBuilder.java) : sélectionne l’un des trois modes sources (`fhir`, `logical`, `oie-message`).
- [OieModelBuilder](../../../src/main/java/fr/kazepoy/fhir/fml/bridge/OieModelBuilder.java) : construit l’arbre générique.
