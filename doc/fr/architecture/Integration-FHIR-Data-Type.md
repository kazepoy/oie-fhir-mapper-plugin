# Intégration avec FHIR Data Type

## Espace de noms et rôle

L'étape graphique est `fr.kazepoy.fhir.mapper.FhirMapperTransformStep` et ses routes
sont exposées sous `/api/extensions/fhir-mapper`. L'étape FML est
`fr.kazepoy.fhir.fml.FhirFmlTransformStep` sous `/api/extensions/fhir-fml`.
Le plugin n'enregistre pas de second type de données FHIR : il utilise le datatype
officiel **1.6.2**. L'initialisation autorise les classes des étapes dans le
sérialiseur XML d'OIE ; `ChannelSerializationTest` couvre l'import/export XML.

## Contrat et isolation

Le reste du mapper appelle `fr.kazepoy.fhir.mapper.fhir.FhirFacade`. Les résultats
de validation appartiennent au mapper et contiennent des listes/maps Java.
Les appels au datatype et à HAPI restent dans `integration/`.

La validation et les conversions utilisent les méthodes publiques du datatype
officiel **1.6.2**, installé sans modification. Le parseur JSON interne
(`fr.kazepoy.fhir.mapper.util.FhirJson`) conserve les décimaux exacts ; celui du
datatype publié n'est pas public.

## Pont de catalogue

Les profils, snapshots et ConceptMaps ne disposent pas d'API publique dans cette
version du prérequis. `FhirCatalogBridge` est donc empaqueté dans un JAR distinct,
absent du classpath OIE, et chargé avec le chargeur HAPI du datatype comme parent.
Les dépendances HAPI de Maven servent uniquement à compiler et tester ; aucun
JAR HAPI n'est ajouté à notre extension.

Le pont réutilise le contexte et la spécification du datatype. Il prépare un
catalogue de lecture des profils pour chaque requête, sans conserver ses
références à la spécification après la requête. La lecture des ConceptMaps reste
indépendante du chargement de la spécification.

Cette compatibilité repose sur trois méthodes internes du moteur 1.6.2 :
`validationContext`, `specification` et `loadProfiles`. Depuis la version 1.5.2,
le datatype démarre lui-même son minuteur de libération dès le chargement du
moteur FHIR ([FD-02](limites-plateforme.md#fd-02) résolu) ; le minuteur de
contournement du mapper a été supprimé. Ces accès sont confinés à l'intégration ;
une évolution du datatype exige de les revérifier. Ils pourront être remplacés par
une API publique si le prérequis l'expose ultérieurement. Le détail et les
demandes au projet amont sont dans les [limites de la plateforme](limites-plateforme.md)
([FD-01](limites-plateforme.md#fd-01), [FD-02](limites-plateforme.md#fd-02)).

## Vérification

`FhirFacadeTest` utilise le JAR du moteur officiel, sans copier ses sources :
conversions, précision des décimaux, validation contre un profil, génération de
snapshot, traduction locale et erreur sur un profil inconnu.

Les propriétés `fhir.engine.direct` et `fhir.mapper.bridge.direct` du POM sont
réservées à ces tests Maven. Elles ne sont pas définies dans la démo : celle-ci
vérifie les chargeurs réellement utilisés en production.
