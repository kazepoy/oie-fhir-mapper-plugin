# Documentation du plugin FHIR

Cette page est l'entrée de la documentation du projet. Chaque section a une
responsabilité distincte afin d'éviter de maintenir la même information dans
plusieurs documents.

## Choisir le transformeur

- Préférer **FHIR FML Transform** lorsqu'une map FML et des Implementation
  Guides peuvent porter une transformation portable, indépendante d'OIE.
- Utiliser **FHIR Mapper Transform** pour construire graphiquement une
  transformation adaptée aux messages et au runtime d'OIE. Son format de mapping
  est propre au plugin.

## Sections

| Besoin | Section | Autorité |
|---|---|---|
| Utiliser les écrans et leurs fonctions | [Manuel utilisateur](fr/user-manual/README.md) | Procédures et captures |
| Comprendre les formats, API et comportements | [Référence](fr/reference/README.md) | Contrats techniques |
| Lancer la démo et rejouer ses exemples | [Démonstration](fr/demo/README.md) | Environnement, exemples et rejeu |
| Construire des canaux avec un agent utilisateur | [Manuel agent](agent-manual/README.md) | Instructions d'utilisation dans OIE |
| Comprendre les composants et contraintes OIE/HAPI | [Architecture](fr/architecture/README.md) | Décisions et limites de plateforme |

## Contrôle

Depuis la racine du dépôt :

```sh
node tools/check_doc_links.mjs
```

Le contrôle refuse les liens locaux cassés et les documents Markdown de `doc/`
qui ne sont pas accessibles depuis le présent index.
