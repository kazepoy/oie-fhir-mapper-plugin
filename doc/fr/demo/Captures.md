# Captures du README et du manuel

[Documentation](../../README.md) · [Démo](Demo.md)

Démarrer et initialiser la démo, puis lancer depuis la racine du dépôt :

```sh
npm --prefix webadmin run capture:docs
```

La commande met à jour les PNG utilisés par le README et le manuel dans
`doc/fr/user-manual/`. Elle utilise les channels de la démo et leurs samples,
sans enregistrer de modification des channels.

Le cadrage est défini dans
[capture-frame.mjs](../../../webadmin/test/e2e/capture-frame.mjs) :

- fenêtre de 1 600 × 1 000 pixels, thème sombre et interface en anglais ;
- panneau de référence à droite fermé ;
- liste des steps ramenée à 140 pixels pour agrandir la zone du plugin ;
- filtre **Mapped only** et branches mappées dépliées pour le mappeur ;
- attente du chargement des polices et du redimensionnement de Monaco ;
- animations désactivées pendant la capture.

Pour ne reprendre qu’une partie des images :

```sh
npm --prefix webadmin run capture:docs -- --only=fml
npm --prefix webadmin run capture:docs -- --only=mapper
npm --prefix webadmin run capture:docs -- --only=settings
```

Les variables `DEMO_URL` et `OIE_DEMO_PASSWORD` permettent de changer l’URL
et le mot de passe. Le compte utilisé est `admin`.
