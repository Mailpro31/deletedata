# deletedata — suppression de mes données chez les data brokers (RGPD)

[![CI](https://github.com/Mailpro31/deletedata/actions/workflows/ci.yml/badge.svg)](https://github.com/Mailpro31/deletedata/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/Node-%E2%89%A520-3c873a.svg)](https://nodejs.org)

Outil **personnel, local et mono-utilisateur** (un « Incogni gratuit auto-hébergé ») qui :

1. **envoie** en mon nom des demandes d'effacement RGPD (art. 17) aux data brokers ;
2. **VÉRIFIE** que mes données ont réellement disparu (preuve de suppression) ;
3. **relance** automatiquement les récalcitrants.

> Je suis mon **propre sujet de données** (RGPD art. 17). Cet outil ne sert qu'à
> **mes** données, pas à celles de tiers. Tout tourne et stocke **en local**.

## ⚡ Démarrage rapide

```bash
git clone https://github.com/Mailpro31/deletedata.git
cd deletedata
npm install                      # dépendances Node
npx playwright install chromium  # navigateur headless (formulaires web + re-scan)
cp .env.example .env             # puis remplir (voir « 3. Configuration »)
npm run db:migrate               # crée la base CHIFFRÉE
npm run doctor                   # affiche ce qui manque + la prochaine étape
```

Puis une **répétition générale sans risque** — rien n'est envoyé (dry-run par défaut) :

```bash
npm run cli -- identity add --label moi --primary --name "Prénom Nom" --email tonemail@gmail.com
npm run cli -- brokers seed          # charge les brokers curatés (actifs)
npm run cli -- draft                 # génère un lot de brouillons
npm run cli -- review 1 --full       # RELIS les emails avant tout envoi réel
```

> 🧭 **Guide pas-à-pas complet** (app password Gmail et Vertex AI clic par clic,
> passage en envoi réel, dépannage, escalade CNIL) : **[GUIDE.md](./GUIDE.md)**.
> Ce README en est la version condensée.

## Sommaire

- [Principes non négociables](#principes-non-négociables)
- [1. Prérequis](#1-prérequis) · [2. Installation](#2-installation) · [3. Configuration `.env`](#3-configuration-du-env)
- [4. Initialiser la base](#4-initialiser-la-base) · [5. Tester les connexions](#5-tester-les-connexions) · [6. Premier cycle (dry-run)](#6-premier-cycle-en-dry-run--rien-ne-part)
- [7. Envoi réel](#7-passer-en-envoi-réel-live) · [8. Vérifier les réponses](#8-vérifier-les-réponses-preuve-de-suppression) · [9. Statut & export](#9-statut-demandes-export)
- [Statuts de confiance](#statuts-de-confiance-le-cœur-de-la-valeur) · [Sécurité locale](#sécurité-locale) · [Architecture](#architecture) · [Passe 2](#passe-2--automatisation-re-scan-scheduler-dashboard)

## Principes non négociables

- **Honnêteté du statut** : jamais affiché « supprimé » sans **preuve réelle**.
  Un simple accusé de réception (`acknowledged`) **ne vaut pas** une suppression
  (`confirmed_deletion`) — il reste « en attente » et déclenchera une relance.
- **Dry-run par défaut** : aucune demande ne part tant que tu n'as pas
  explicitement activé le mode live (double verrou). Impossible d'envoyer par accident.
- **Approbation par lot** : tu vois exactement ce qui partira sous ton nom, et tu l'approuves.
- **Chiffrement au repos** : toute la base est chiffrée (SQLCipher).

---

## 1. Prérequis

- **Node.js ≥ 20** (testé sur Node 22).
- Outils de build natifs (pour `better-sqlite3-multiple-ciphers`) : `python3`, `make`, `g++`.
  - Debian/Ubuntu : `sudo apt-get install -y build-essential python3`
- Un compte **Gmail** (recommandé pour le plus-addressing) avec 2FA activée.
- Un projet **Google Cloud** avec **Vertex AI** activé (PAS Google AI Studio).

## 2. Installation

```bash
git clone https://github.com/Mailpro31/deletedata.git
cd deletedata
npm install                      # dépendances Node
npx playwright install chromium  # navigateur headless (formulaires + re-scan)
cp .env.example .env             # puis éditer .env (étape 3)
```

> `npm install` échoue sur `better-sqlite3` ? Il manque les outils de build natifs
> (voir « 1. Prérequis »). Sous Windows, utilise WSL2.

## 3. Configuration du `.env`

Le `.env` est **git-ignoré**. N'y mets jamais de secret destiné à être committé.

### 3.1 Passphrase de la base chiffrée

```env
DB_PATH=./data/deletedata.db
DB_PASSPHRASE=<une passphrase longue et unique>
```

⚠️ Si tu perds cette passphrase, les données sont **irrécupérables**. Elle est lue
depuis une variable d'env (pour permettre au scheduler de tourner sans
surveillance en Passe 2) : cela protège contre le **vol du fichier/disque**, mais
**pas** contre quelqu'un qui a déjà accès à cet environnement.

### 3.2 Gmail — App Password (SMTP + IMAP)

1. Active la **validation en deux étapes** sur ton compte Google
   (https://myaccount.google.com/security).
2. Crée un **mot de passe d'application** :
   https://myaccount.google.com/apppasswords → choisis « Autre », nomme-le
   « deletedata ». Tu obtiens 16 caractères.
3. Renseigne dans `.env` (le même app password fonctionne pour SMTP et IMAP) :

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=monemail@gmail.com
SMTP_PASS=<app password 16 car.>

IMAP_HOST=imap.gmail.com
IMAP_PORT=993
IMAP_SECURE=true
IMAP_USER=monemail@gmail.com
IMAP_PASS=<app password 16 car.>
IMAP_MAILBOX=INBOX
```

> **Plus-addressing** : les demandes partent avec un alias
> `monemail+broker-slug@gmail.com` en From/Reply-To. Gmail route tout vers ta
> boîte, et l'alias dans le champ « To » de la réponse permet de savoir
> **immédiatement** quel broker a répondu. Rien à configurer côté Gmail.

### 3.3 Vertex AI (classification des réponses)

Vertex **n'entraîne pas** sur tes données et est conforme RGPD/UE — c'est
pourquoi on l'utilise (et non le free tier d'AI Studio) pour classer des emails
contenant tes données personnelles.

1. Crée/choisis un **projet Google Cloud dédié** et active l'API **Vertex AI**.
2. Crée un **service account** avec le rôle **`roles/aiplatform.user`** et
   télécharge sa **clé JSON** (ou, en dev local, utilise
   `gcloud auth application-default login`).
3. Renseigne `.env` :

```env
GOOGLE_CLOUD_PROJECT=mon-projet-gcp
GOOGLE_CLOUD_LOCATION=europe-west1          # région UE (résidence des données)
VERTEX_MODEL=gemini-2.5-flash               # modèle GA, rapide et économique
GOOGLE_APPLICATION_CREDENTIALS=/chemin/vers/service-account.json
```

> Coût : quelques centaines de classifications tous les 2-3 mois ⇒ **négligeable**.

## 4. Initialiser la base

```bash
npm run db:migrate
```

Crée la base **chiffrée** `data/deletedata.db` et applique le schéma.

## 5. Tester les connexions

```bash
npm run doctor              # config + base + état + prochaine action (n'envoie rien)
npm run test-connections    # vérifie SMTP / IMAP / Vertex (texte de test, sans PII)
```

`doctor` coche ✓/✗ chaque groupe de config (sans révéler de secret) et indique la
prochaine étape. `test-connections` valide les connexions réseau.

---

## 6. Premier cycle (en DRY-RUN — rien ne part)

Le CLI s'invoque via `npm run cli -- <commande>`.

```bash
# 6.1 Déclarer mon identité (variantes de nom, emails, adresses)
npm run cli -- identity add --label "moi" --primary \
  --name "Jean Dupont" --name "Jean DUPOND" \
  --email "monemail@gmail.com" \
  --address "12 rue Exemple, 75001 Paris"

# 6.2 Charger des brokers : seed curaté (actifs) + import large (visibilité)
npm run cli -- brokers seed
npm run cli -- brokers import eraser --file ./chemin/brokers.yaml   # optionnel
npm run cli -- brokers list --active

# 6.3 Générer les brouillons (lot 'à approuver')
npm run cli -- draft

# 6.4 RELIRE exactement ce qui partira (corps complet avec --full)
npm run cli -- review                 # liste les lots en attente
npm run cli -- review 1 --full        # détaille le lot #1

# 6.5 Approuver le lot
npm run cli -- approve 1

# 6.6 « Envoyer » — en DRY-RUN, rien ne part : les emails sont seulement loggés
npm run cli -- send --batch 1

# 6.7 État honnête
npm run cli -- status
```

### Corriger un broker sans coder (overrides)

```bash
npm run cli -- brokers override spokeo --set email=privacy@spokeo.com --set channel=email --note "adresse vérifiée"
```

## 7. Passer en envoi RÉEL (live)

Double verrou — il faut **les deux** dans `.env` :

```env
DRY_RUN=false
LIVE_CONFIRM=I_UNDERSTAND
```

Puis, idéalement, tester d'abord sur **un seul** broker (ou vers ton propre alias) :

```bash
npm run cli -- send --batch 1 --max 1
```

Un email réel part ; la demande passe en `sent`, avec une **deadline à 1 mois**.

## 8. Vérifier les réponses (preuve de suppression)

```bash
npm run cli -- verify
```

Le pipeline IMAP, en incrémental :

1. lit les nouveaux mails (suivi par UID, idempotent) ;
2. rattache chaque réponse au bon broker (**plus-address > domaine > threading**) ;
3. classe le **sens** via Vertex (`confirmed_deletion`, `acknowledged`, …) ;
4. met à jour le statut + journalise dans l'audit.

> **Test du garde-fou central** : envoie-toi à l'alias un mail « we have deleted
> your data » → doit devenir `confirmed_email`. Un mail « we received your
> request » → doit **rester `pending`** (accusé de réception ≠ suppression).

Les mails non rattachables vont dans la **file « à revoir »** (visible dans `status`).

## 9. Statut, demandes, export

```bash
npm run cli -- status                       # vue d'ensemble + % honnête
npm run cli -- requests --not-sent          # filtres: --status --confidence --channel --broker
npm run cli -- export --format csv --out historique.csv   # preuve RGPD
```

---

## Statuts de confiance (le cœur de la valeur)

| Confiance          | Signification                                              |
| ------------------ | ---------------------------------------------------------- |
| `confirmed_email`  | suppression **confirmée par email** (preuve la plus forte) |
| `confirmed_rescan` | re-scan du site ne retrouve plus mon profil (Passe 2)      |
| `reminded`         | sans réponse à la deadline → relance envoyée               |
| `pending`          | envoyé, dans le délai légal d'un mois                       |
| `unverifiable`     | aucun moyen de vérification public → tracé honnêtement      |
| `refused`          | le broker a refusé                                         |

## Sécurité locale

- `.env` git-ignoré ; credentials jamais committés, **jamais loggés** (redaction).
- Base **entièrement chiffrée** (SQLCipher) ; fichier illisible sans la passphrase.
- Région Vertex **UE**. Avertissement clair hors dry-run. Double verrou avant tout envoi.

## Architecture

```
src/
  config/    env (zod) · crypto (scrypt + AES-GCM) · logger (redaction)
  db/        client (SQLCipher) · schema (Drizzle) · migrations
  domain/    statuts + transitions (garde-fou acknowledged ≠ confirmed) · types
  brokers/   import (eraser/justvanish/badbool) + seed curaté + registry (overrides)
  identity/  variantes de mon identité
  requests/  template RGPD fr · brouillons · anti-spam · approbation · relances
  send/      plus-addressing · envoi email (dry-run + double verrou + retry)
  forms/     remplissage de formulaires Playwright (jetons + screenshots)   [P2]
  verify/    imap (incrémental · rattachement · Vertex) · rescan (Playwright) [P2]
  scheduler/ cycle complet + node-cron                                       [P2]
  server/    API Express (pilote le dashboard)                               [P2]
  reporting/ statut honnête + export
  cli/       pilotage
web/         dashboard React + Vite (proxy /api -> API locale)               [P2]
```

### Sources de brokers

- **Eraser** (`digisamroc/eraser`, MIT) — base large.
- **JustVanish** (`AnalogJ/justvanish`, MIT) — métadonnées RGPD.
- **Big-Ass Data Broker Opt-Out List** (CC BY-NC-SA) — OK en usage **personnel
  non commercial**, avec attribution.
- **Seed curaté EU/FR** intégré (sous-ensemble `active`).

Aucune source n'encode proprement le canal (email/form/manual) : il est **inféré**
puis corrigé via la curation (`active`) et les `overrides`.

## Passe 2 — automatisation, re-scan, scheduler, dashboard

Prérequis Playwright (formulaires + re-scan) : installer le navigateur une fois :

```bash
npx playwright install chromium
```

### Remplissage automatique de formulaires (Playwright)

Définis une config par broker (YAML), avec des jetons d'identité
(`$email`, `$fullName`, `$firstName`, `$lastName`, `$address`, `$phone`,
`$plusAlias`) :

```yaml
# spokeo-form.yaml
forms:
  - url: "https://www.spokeo.com/optout"
    fields:
      - { selector: "#email", value: "$email" }
      - { selector: "#consent", action: "check" }
    submitSelector: "button[type=submit]"
```

```bash
npm run cli -- forms set-config spokeo --file spokeo-form.yaml
npm run cli -- forms rehearse spokeo     # remplit SANS soumettre + screenshot (test)
```

En **live**, `cli send` soumet automatiquement les formulaires configurés
(screenshots dans `./screenshots`). Sans config, le broker reste « action manuelle ».

### Re-scan (preuve `confirmed_rescan`)

Pour les brokers à recherche publique, configure une recherche :

```yaml
# spokeo-rescan.yaml
searchUrl: "https://www.spokeo.com/$firstName-$lastName"
foundSelector: ".result-card"          # présent => profil ENCORE là
notFoundText: "no results found"       # présent => supprimé
waitMs: 2000
```

```bash
npm run cli -- rescan set-config spokeo --file spokeo-rescan.yaml
npm run cli -- rescan run               # profil absent => confidence confirmed_rescan
```

Honnête : ne conclut « supprimé » que si `notFoundText` est présent **et**
aucun `foundSelector` ne matche. Un profil réapparu après confirmation =
**réacquisition** (repasse en attente).

### Relances & cycle complet

```bash
npm run cli -- remind          # relance les demandes en attente hors délai (max 2)
npm run cli -- cycle           # re-scan + vérif IMAP + relances + nouveaux brouillons
```

Le cycle **n'envoie jamais sans approbation** : il notifie quand un lot t'attend.

### Scheduler (node-cron)

```bash
npm run cli -- schedule --now              # cycle immédiat puis tous les 2 mois
# ou: SCHEDULE_CRON="0 9 1 */3 *" npm run cli -- schedule
```

### Dashboard (React + Vite)

- **Dev** : `npm run cli -- serve` (API sur :4317) + `npm run dev --prefix web` (UI sur :5173, proxy /api).
- **Prod local** : `npm run build --prefix web` puis `npm run cli -- serve` → tout sur `http://127.0.0.1:4317`.

Le dashboard montre l'indicateur honnête (% confirmées supprimées), les brokers
(filtres, activation, overrides), les demandes (détail + preuve), l'approbation
des lots, la file « à revoir », et les actions (brouillons / envoi / vérif /
re-scan / cycle).

## Avertissement

Outil fourni tel quel, pour un usage personnel et légitime (mes propres données).
Les emails/URLs d'opt-out des brokers évoluent : **vérifie-les** avant un envoi
réel (les garde-fous dry-run + approbation sont là pour ça).
