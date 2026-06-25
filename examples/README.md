# Exemples de configuration

Modèles à **copier et adapter**. Ils ne sont *pas* appliqués automatiquement : à toi
de renseigner les vrais sélecteurs de chaque broker (clic droit → « Inspecter » sur
la page d'opt-out).

| Fichier                        | Pour quoi                                          | Commande                              |
| ------------------------------ | -------------------------------------------------- | ------------------------------------- |
| `form-config.example.yaml`     | Remplir un formulaire web (canal `form`)           | `forms set-config <slug> --file …`    |
| `rescan-config.example.yaml`   | Vérifier par recherche publique (`confirmed_rescan`) | `rescan set-config <slug> --file …`  |

Marche à suivre détaillée : [GUIDE.md](../GUIDE.md), sections 13 (formulaires) et 14
(re-scan). Teste toujours un formulaire avec `forms rehearse <slug>` (remplit **sans
soumettre**) avant de passer en envoi réel.
