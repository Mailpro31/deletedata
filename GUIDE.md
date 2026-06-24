# Guide complet — deletedata

Guide pas-à-pas, de zéro jusqu'à « **mes données sont confirmées supprimées** ».
Aucune connaissance technique avancée requise : suis les sections dans l'ordre.

> Ce guide est volontairement détaillé. Le [`README.md`](./README.md) en est la
> version courte (référence). Si tu es pressé : sections **3 → 6 → 9** suffisent
> pour un premier essai sans risque (tout en dry-run).

## Sommaire

1. [Ce que fait l'outil (et sa promesse)](#1-ce-que-fait-loutil-et-sa-promesse)
2. [Concepts à comprendre avant de commencer (5 min)](#2-concepts-à-comprendre-avant-de-commencer-5-min)
3. [Prérequis système](#3-prérequis-système)
4. [Récupérer le projet & installer](#4-récupérer-le-projet--installer)
5. [Créer tes accès externes (la partie la plus longue)](#5-créer-tes-accès-externes-la-partie-la-plus-longue)
6. [Configurer le `.env`](#6-configurer-le-env-champ-par-champ)
7. [Initialiser et tester](#7-initialiser-et-tester)
8. [Déclarer ton identité](#8-déclarer-ton-identité)
9. [Charger les data brokers](#9-charger-les-data-brokers)
10. [Répétition générale en DRY-RUN (obligatoire)](#10-répétition-générale-en-dry-run-obligatoire)
11. [Passer en envoi réel (live)](#11-passer-en-envoi-réel-live)
12. [Vérifier la suppression (le cœur)](#12-vérifier-la-suppression-le-cœur)
13. [Formulaires web (Playwright)](#13-formulaires-web-playwright--brokers-sans-email)
14. [Re-scan (preuve `confirmed_rescan`)](#14-re-scan-preuve-confirmed_rescan)
15. [Relances & automatisation](#15-relances--automatisation)
16. [Tableau de bord](#16-tableau-de-bord-dashboard)
17. [Quand un broker ignore ou refuse (escalade RGPD)](#17-quand-un-broker-ignore-ou-refuse-escalade-rgpd)
18. [Sécurité & bonnes pratiques](#18-sécurité--bonnes-pratiques)
19. [Dépannage (FAQ)](#19-dépannage-faq)
20. [Référence rapide des commandes](#20-référence-rapide-des-commandes)
21. [Glossaire](#21-glossaire)

---

## 1. Ce que fait l'outil (et sa promesse)

`deletedata` est un « Incogni gratuit auto-hébergé », **personnel et local** :

1. **Envoie** en ton nom des demandes d'effacement RGPD (article 17) aux data brokers.
2. **VÉRIFIE** que tes données ont réellement disparu — le différenciateur.
3. **Relance** automatiquement ceux qui ne répondent pas.

**Sa promesse, c'est l'honnêteté.** L'outil n'affiche **jamais** « supprimé » sans
preuve réelle. Un simple « nous avons bien reçu votre demande » ne compte pas : la
demande reste « en attente » et sera relancée. Le pourcentage « confirmé supprimé »
n'est donc jamais gonflé — c'est ce qui le distingue d'un service qui te dit « c'est
fait » sans rien vérifier.

**Tout reste chez toi** : base de données chiffrée en local, aucun serveur tiers
(hormis Gmail pour l'envoi/réception et Vertex AI pour classer les réponses).

> ⚖️ **Cadre légal.** Tu es ton **propre sujet de données** (RGPD art. 17). Cet
> outil sert à **tes** données, pas à celles de tiers. N'envoie pas de demandes au
> nom de quelqu'un d'autre sans mandat.

### Checklist générale (vue d'ensemble)

- [ ] Node.js ≥ 20 installé (section 3)
- [ ] Projet installé : `npm install` (section 4)
- [ ] App password Gmail créé (section 5.1)
- [ ] *(Optionnel pour démarrer)* Vertex AI configuré (section 5.2)
- [ ] `.env` rempli (section 6)
- [ ] Base initialisée + connexions testées (section 7)
- [ ] Identité déclarée (section 8)
- [ ] Brokers chargés (section 9)
- [ ] **Répétition en dry-run réussie** (section 10)
- [ ] Passage en live (section 11)
- [ ] Vérification ~1 mois plus tard (section 12)

---

## 2. Concepts à comprendre avant de commencer (5 min)

Cinq minutes ici t'éviteront toute confusion plus tard.

### 2.1 Le RGPD article 17 (droit à l'effacement)

Tu as le droit d'exiger qu'une entreprise efface tes données personnelles. Elle doit
répondre **sous un mois** (extensible à 3 mois pour les cas complexes, art. 12). Si
elle refuse, elle doit le **justifier**. Pas de réponse = tu peux saisir la **CNIL**
(voir [section 17](#17-quand-un-broker-ignore-ou-refuse-escalade-rgpd)).

### 2.2 Le plus-addressing (pourquoi `monemail+slug@gmail.com`)

Pour chaque broker, l'outil utilise un alias dérivé de ton email :
`monemail+spokeo@gmail.com`. Gmail route **tout** vers ta boîte normale, mais la
réponse du broker arrive avec l'alias dans le champ « À ». Résultat : on sait
**immédiatement et de façon fiable** quel broker a répondu, sans deviner. Rien à
configurer côté Gmail — ça marche d'office.

### 2.3 Le modèle de confiance (le cœur de l'honnêteté)

Chaque demande a un **statut de confiance** affiché tel quel :

| Confiance          | Signification                                                   |
| ------------------ | --------------------------------------------------------------- |
| `confirmed_email`  | suppression **confirmée par email** (preuve la plus forte)      |
| `confirmed_rescan` | re-scan public du site ne retrouve plus ton profil              |
| `reminded`         | pas de réponse à l'échéance → relance envoyée                   |
| `pending`          | envoyé, encore dans le délai légal d'un mois                    |
| `unverifiable`     | aucun moyen de vérification public → tracé honnêtement          |
| `refused`          | le broker a refusé (doit être justifié)                         |

**Seuls** `confirmed_email` et `confirmed_rescan` comptent dans le « % confirmé
supprimé ».

### 2.4 LE garde-fou central : accusé de réception ≠ suppression

C'est la règle la plus importante de tout l'outil :

> Un email « nous avons bien reçu votre demande » est classé `acknowledged` et **reste
> `pending`**. Il ne devient **JAMAIS** « supprimé ». Seul un email qui dit
> explicitement « vos données **ont été** supprimées » (classé `confirmed_deletion`)
> fait passer la demande en `confirmed_email`.

C'est ce qui garantit que le chiffre que tu vois est vrai.

### 2.5 Dry-run vs Live (le double verrou)

- **Dry-run (par défaut)** : l'outil génère et te montre les emails, écrit l'audit,
  mais **n'envoie rien**. Impossible d'envoyer par accident.
- **Live** : pour envoyer pour de vrai, il faut **les DEUX** dans `.env` :
  `DRY_RUN=false` **ET** `LIVE_CONFIRM=I_UNDERSTAND`. Si l'un manque, l'envoi est bloqué.

---

## 3. Prérequis système

- **Node.js ≥ 20** (testé sur Node 22). Vérifie : `node --version`.
  - Pas installé ? Via [nvm](https://github.com/nvm-sh/nvm) :
    `nvm install 22 && nvm use 22`.
- **Outils de build natifs** (pour le module SQLite chiffré) :
  - Debian/Ubuntu : `sudo apt-get install -y build-essential python3`
  - macOS : `xcode-select --install`
  - Windows : utilise WSL2 (Ubuntu), c'est le plus simple.
- **git** (pour récupérer le projet).
- Un compte **Gmail** avec la validation en 2 étapes (section 5.1).
- *(Optionnel pour démarrer)* un projet **Google Cloud** (section 5.2).

---

## 4. Récupérer le projet & installer

```bash
# 1. Récupérer le code (si pas déjà fait)
git clone <url-du-dépôt> deletedata
cd deletedata

# 2. Installer les dépendances
npm install

# 3. Installer le navigateur pour Playwright (formulaires web + re-scan)
npx playwright install chromium

# 4. Préparer la config
cp .env.example .env
```

> Si `npm install` échoue sur `better-sqlite3` → il manque les outils de build
> natifs (voir section 3). C'est l'erreur d'installation la plus fréquente.

---

## 5. Créer tes accès externes (la partie la plus longue)

C'est ici que tu passeras le plus de temps. Le reste n'est que des commandes.

### 5.1 Gmail — mot de passe d'application (SMTP + IMAP)

On n'utilise **jamais** ton vrai mot de passe Gmail, mais un « mot de passe
d'application » dédié (révocable à tout moment).

1. Active la **validation en deux étapes** :
   <https://myaccount.google.com/security> → « Validation en deux étapes ».
   *(Obligatoire : sans elle, l'option suivante n'apparaît pas.)*
2. Va sur <https://myaccount.google.com/apppasswords>.
3. Saisis un nom (ex. `deletedata`) → **Créer**.
4. Google affiche **16 caractères** (souvent en 4 blocs). Copie-les (tu peux retirer
   les espaces). C'est ce que tu mettras dans `SMTP_PASS` **et** `IMAP_PASS`.

> 🔁 Le même app password fonctionne pour l'envoi (SMTP) et la réception (IMAP).
> 🗑️ Tu peux le révoquer quand tu veux depuis la même page — l'outil cesse alors
> d'accéder à ta boîte.

#### (Optionnel) Organiser les réponses avec un libellé Gmail

Pour regrouper toutes les réponses des brokers au même endroit, crée un **filtre
Gmail** qui leur applique un libellé (ex. `deletedata`) :

1. Gmail → roue dentée → « Voir tous les paramètres » → « Filtres et adresses
   bloquées » → « Créer un filtre ».
2. Champ **« À »** : `tonemail+*@gmail.com` (capte tous les alias de plus-addressing).
3. « Créer un filtre » → coche **« Appliquer le libellé »** → `deletedata`.

Bonus : tu peux alors **restreindre la vérification** à ce libellé en mettant
`IMAP_MAILBOX=deletedata` dans `.env` (moins de bruit, plus rapide à scanner).
Pour retirer le libellé plus tard : Gmail → Paramètres → Libellés → supprimer.

### 5.2 Google Cloud + Vertex AI (classification des réponses)

**Tu peux SAUTER cette étape pour démarrer.** Sans Vertex, tu utilises
`verify --no-classify` : l'outil rattache les réponses au bon broker, et tu lis
toi-même le verdict. Vertex sert à **automatiser** ce classement (utile surtout pour
le mode planifié). Reviens-y quand tu veux.

Pourquoi Vertex et **pas** Google AI Studio ? Vertex AI **n'entraîne pas** ses
modèles sur tes données et offre la résidence des données en UE — adapté à des
emails contenant tes informations personnelles.

1. Va sur la [console Google Cloud](https://console.cloud.google.com/) → crée (ou
   choisis) un **projet dédié** (ex. `deletedata-perso`). Note son **ID de projet**.
2. Active l'API **Vertex AI** :
   [APIs & Services → Library](https://console.cloud.google.com/apis/library) →
   cherche « Vertex AI API » → **Activer**.
3. Crée un **compte de service** :
   [IAM & Admin → Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts)
   → « Créer un compte de service » → donne-lui le rôle **`Utilisateur Vertex AI`**
   (`roles/aiplatform.user`).
4. Crée une **clé JSON** pour ce compte : onglet « Clés » → « Ajouter une clé » →
   « JSON ». Un fichier `.json` se télécharge. **Range-le hors du dépôt** (il est
   git-ignoré par sécurité, mais ne le mets pas dans le projet).
   - Alternative en dev local, sans clé : `gcloud auth application-default login`.
5. Choisis une **région UE** : `europe-west1` (Belgique) ou `europe-west4` (Pays-Bas).

> 💶 **Coût.** Quelques centaines de classifications tous les 2-3 mois avec
> `gemini-2.5-flash` ⇒ **négligeable** (de l'ordre du centime). Surveille quand même
> ton budget GCP la première fois.

---

## 6. Configurer le `.env` (champ par champ)

Ouvre `.env` (créé à la section 4) et remplis-le. Il est **git-ignoré** : tes secrets
n'y seront jamais committés.

```env
# --- Garde-fous d'envoi : laisse en dry-run pour l'instant ---
DRY_RUN=true
LIVE_CONFIRM=

# --- Base chiffrée ---
DB_PATH=./data/deletedata.db
DB_PASSPHRASE=choisis-une-phrase-longue-unique-et-garde-la-precieusement

# --- Gmail (SMTP = envoi) ---
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=monemail@gmail.com
SMTP_PASS=les16caracteres        # app password de la section 5.1
MAIL_FROM_NAME=Prénom Nom         # optionnel (nom affiché)
MAIL_BASE_ADDRESS=                # vide = identique à SMTP_USER

# --- Gmail (IMAP = réception/vérification) ---
IMAP_HOST=imap.gmail.com
IMAP_PORT=993
IMAP_SECURE=true
IMAP_USER=monemail@gmail.com
IMAP_PASS=les16caracteres        # le même app password
IMAP_MAILBOX=INBOX

# --- Vertex AI (optionnel au début — voir 5.2) ---
GOOGLE_CLOUD_PROJECT=mon-projet-gcp
GOOGLE_CLOUD_LOCATION=europe-west1
VERTEX_MODEL=gemini-2.5-flash
GOOGLE_APPLICATION_CREDENTIALS=/chemin/absolu/vers/service-account.json

# --- Divers ---
LOG_LEVEL=info
RETARGET_DAYS=90                 # délai anti-spam avant de re-cibler un broker non confirmé
```

> ⚠️ **`DB_PASSPHRASE` : si tu la perds, la base est IRRÉCUPÉRABLE.** Note-la dans
> ton gestionnaire de mots de passe. Elle protège contre le vol du fichier/disque,
> pas contre quelqu'un qui a déjà accès à cet ordinateur.

---

## 7. Initialiser et tester

```bash
# Crée la base CHIFFRÉE et applique le schéma
npm run db:migrate

# Diagnostic : ce qui est configuré, ce qui manque, et la prochaine action
npm run doctor

# Vérifie les connexions réseau SMTP / IMAP / Vertex (texte de test, AUCUNE donnée perso)
npm run test-connections
```

`npm run doctor` est ta commande **« où j'en suis ? »** : il affiche le mode
(dry-run/live), coche ✓/✗ chaque groupe de config (sans jamais révéler un secret),
indique si la base est lisible, et te donne la prochaine action. Reviens-y dès que
tu as un doute.

`test-connections` te dit, ligne par ligne, ce qui marche :

- **SMTP OK** → l'envoi fonctionnera.
- **IMAP OK** → la vérification pourra lire tes réponses.
- **Vertex OK** → la classification automatique fonctionnera (ignore si tu sautes Vertex).

Un échec ici ? Va directement au [dépannage (section 19)](#19-dépannage-faq).

---

## 8. Déclarer ton identité

L'outil a besoin de savoir qui tu es pour rédiger les demandes. **Astuce clé :**
déclare toutes les **variantes** de ton nom (nom de jeune fille, fautes courantes,
avec/sans accents) — les brokers t'indexent souvent sous plusieurs orthographes.

```bash
npm run cli -- identity add --label "moi" --primary \
  --name "Jean Dupont" --name "Jean DUPOND" --name "J. Dupont" \
  --email "monemail@gmail.com" \
  --address "12 rue Exemple, 75001 Paris" \
  --phone "0600000000"

# Vérifier
npm run cli -- identity list
```

Options répétables : `--name`, `--email`, `--address`, `--phone`. Autres :
`--birthdate <date>`, `--primary` (identité par défaut).

---

## 9. Charger les data brokers

```bash
# Jeu curaté EU/FR, prêt à l'emploi (marqués "actifs")
npm run cli -- brokers seed

# Voir les brokers actifs (ceux qui partiront)
npm run cli -- brokers list --active

# (Optionnel) Importer une liste plus large pour visibilité
npm run cli -- brokers import eraser            # URL par défaut de la source
# ou depuis un fichier local : --file ./brokers.yaml
```

Seuls les brokers **`active`** reçoivent des demandes. Les autres sont des pistes à
enrichir. Tu pilotes ça :

```bash
npm run cli -- brokers activate <slug>          # rendre actif
npm run cli -- brokers deactivate <slug>        # désactiver

# Corriger un broker SANS coder (email/canal/URL) :
npm run cli -- brokers override spokeo \
  --set email=privacy@spokeo.com --set channel=email \
  --note "adresse vérifiée le 2026-06-24"
```

Filtres utiles : `brokers list --channel email --jurisdiction eu --search acxiom`.

> **Canal d'un broker** : `email` (on écrit), `form` (formulaire web → section 13),
> `manual` (action manuelle, ex. pièce d'identité requise). Inféré à l'import, puis
> corrigé via `override`.

---

## 10. Répétition générale en DRY-RUN (obligatoire)

Fais **toujours** cette répétition avant le live. Rien ne part.

```bash
# 10.1 Générer les brouillons (un "lot à approuver")
npm run cli -- draft
#   -> affiche "Lot #1 : N créés..."  Retiens le numéro de lot.

# 10.2 LIRE exactement ce qui partira sous ton nom
npm run cli -- review                # liste les lots en attente
npm run cli -- review 1 --full       # corps COMPLET des emails du lot #1

# 10.3 Approuver le lot (prérequis à tout envoi)
npm run cli -- approve 1

# 10.4 "Envoyer" — en dry-run : emails seulement loggés, RIEN ne part
npm run cli -- send --batch 1

# 10.5 État honnête
npm run cli -- status
```

Ce que tu dois voir : à l'étape 10.4, le bilan indique des envois **« simulé(s)
[dry-run] »**. À l'étape 10.5, le mode affiché est **« DRY-RUN (aucun envoi) »**.

> Cible un sous-ensemble si tu veux : `draft --broker spokeo --broker acxiom`, ou
> limite à un canal : `draft --channel email`.

---

## 11. Passer en envoi réel (live)

Quand tu as **relu** les emails et que tu es prêt :

1. Édite `.env` et mets **les deux** verrous :
   ```env
   DRY_RUN=false
   LIVE_CONFIRM=I_UNDERSTAND
   ```
2. Teste d'abord sur **un seul** envoi (ou vers ton propre alias) :
   ```bash
   npm run cli -- send --batch 1 --max 1
   ```
   Le bandeau « ⚠️ MODE LIVE » s'affiche. Un email réel part ; la demande passe en
   `sent` avec une **échéance à 1 mois**.
3. Si tout est bon, envoie le reste :
   ```bash
   npm run cli -- send --batch 1
   ```

> 🛡️ **Anti-spam.** L'outil ne re-cible pas un broker tant que (a) la suppression
> n'est pas confirmée, **et** (b) `RETARGET_DAYS` (90 j par défaut) ne sont pas
> écoulés — sauf réacquisition détectée. Tu ne harcèles personne par mégarde.

---

## 12. Vérifier la suppression (le cœur)

Environ **une fois par semaine** après l'envoi (et obligatoirement à l'approche du
1ᵉʳ mois) :

```bash
npm run cli -- verify
#   sans Vertex : npm run cli -- verify --no-classify
```

Le pipeline IMAP, en incrémental (il ne relit jamais deux fois le même mail) :

1. lit les nouveaux mails (suivi par UID, idempotent) ;
2. **rattache** chaque réponse au bon broker (plus-address > domaine > threading) ;
3. **classe** le sens via Vertex (`confirmed_deletion`, `acknowledged`, `refused`…) ;
4. met à jour le statut **selon le garde-fou** (accusé ≠ supprimé) + journalise l'audit.

Les mails non rattachables atterrissent dans la **file « à revoir »** (jamais
classés au hasard).

### Tester le garde-fou toi-même (recommandé une fois)

- Envoie-toi à ton alias un mail disant « we have deleted your data » →
  après `verify`, la demande doit devenir `confirmed_email`.
- Envoie-toi « we have received your request » → elle doit **rester `pending`**
  (accusé de réception). Si c'est le cas, l'honnêteté de l'outil est prouvée.

### Suivre l'état

```bash
npm run cli -- status                       # vue d'ensemble + % CONFIRMÉ honnête
npm run cli -- requests --status sent       # filtres: --confidence --channel --broker --not-sent
npm run cli -- export --format csv --out preuve-rgpd.csv   # historique exportable
```

L'export est ta **trace** (utile en cas de plainte CNIL — section 17).

---

## 13. Formulaires web (Playwright) — brokers sans email

Certains brokers n'acceptent les demandes que via un **formulaire web**. Pour ceux-là
(canal `form`), tu fournis une petite config qui dit quels champs remplir.

### Trouver les sélecteurs

Ouvre la page d'opt-out du broker → clic droit sur un champ → « Inspecter ». Note son
`id` (`#email`), sa `classe` (`.consent-box`) ou son `name` (`input[name=email]`).

### Écrire la config (YAML)

```yaml
# spokeo-form.yaml
forms:
  - url: "https://www.spokeo.com/optout"
    fields:
      - { selector: "#email", value: "$email" }       # $email = alias traçable du broker
      - { selector: "#consent", action: "check" }
    submitSelector: "button[type=submit]"
```

Jetons d'identité disponibles dans `value` :
`$email` (alias du broker), `$primaryEmail`, `$fullName`, `$firstName`, `$lastName`,
`$address`, `$phone`, `$plusAlias`.
Actions possibles : `fill` (défaut), `check`, `uncheck`, `click`, `select`.

### Attacher et tester

```bash
npm run cli -- forms set-config spokeo --file spokeo-form.yaml

# Répétition : remplit le formulaire SANS soumettre + prend un screenshot
npm run cli -- forms rehearse spokeo
#   -> vérifie les "✓ N champ(s) rempli(s)" et le screenshot dans ./screenshots
```

En **live**, `cli send` soumet automatiquement les formulaires configurés
(screenshots dans `./screenshots`, y compris en cas d'échec). Sans config, un broker
`form`/`manual` reste marqué « action manuelle ».

---

## 14. Re-scan (preuve `confirmed_rescan`)

Pour les brokers à **recherche publique** (annuaires de type « people-search »), on
peut **vérifier visuellement** que ton profil a disparu — une preuve indépendante de
l'email.

```yaml
# spokeo-rescan.yaml
searchUrl: "https://www.spokeo.com/$firstName-$lastName"
foundSelector: ".result-card"          # PRÉSENT => profil ENCORE là
notFoundText: "no results found"       # PRÉSENT => supprimé
waitMs: 2000
# Optionnel : remplir un formulaire de recherche avant de lire
# searchForm:
#   fields:
#     - { selector: "#q", value: "$fullName" }
#   submitSelector: "button.search"
```

```bash
npm run cli -- rescan set-config spokeo --file spokeo-rescan.yaml
npm run cli -- rescan run               # ou --broker spokeo pour le cibler
```

**Honnête par construction** : ne conclut « supprimé » (`confirmed_rescan`) que si
`notFoundText` est présent **et** aucun `foundSelector` ne matche. Si un profil
**réapparaît** après une confirmation, c'est une **réacquisition** : la demande
repasse en attente (le broker t'a re-collecté).

---

## 15. Relances & automatisation

```bash
# Relancer les demandes email en attente qui ont dépassé l'échéance (max 2 relances)
npm run cli -- remind

# Un cycle complet en une commande : re-scan + vérif IMAP + relances + nouveaux brouillons
npm run cli -- cycle
#   options pour en sauter : --no-rescan --no-verify --no-remind --no-draft
```

Le `cycle` **n'envoie jamais sans ton approbation** : il prépare et te notifie quand
un lot t'attend.

### Scheduler (tourne tout seul tous les 2-3 mois)

```bash
npm run cli -- schedule --now                       # cycle immédiat, puis planifié
# Cron personnalisé (ici tous les 3 mois, le 1er à 9h) :
SCHEDULE_CRON="0 9 1 */3 *" npm run cli -- schedule
```

Par défaut : **09:00, le 1ᵉʳ de chaque 2ᵉ mois** (`0 9 1 */2 *`). Le processus reste
ouvert ; `Ctrl+C` pour l'arrêter. Pour qu'il survive à une déconnexion, lance-le sous
`tmux`/`screen` ou en service systemd.

---

## 16. Tableau de bord (dashboard)

Interface web locale (sur `127.0.0.1` uniquement — jamais exposée à Internet).

```bash
# Prod local (recommandé) : build une fois, puis sers tout sur un seul port
npm run build --prefix web
npm run cli -- serve                 # -> http://127.0.0.1:4317

# Dev (rechargement à chaud) : deux terminaux
npm run cli -- serve                 # API sur :4317
npm run dev --prefix web             # UI sur :5173 (proxy /api -> 4317)
```

Le dashboard montre : l'**indicateur honnête** (% confirmé supprimé), les brokers
(filtres, activation, overrides), les demandes (détail + preuve), l'approbation des
lots, la file « à revoir » et les actions (brouillons / envoi / vérif / re-scan / cycle).

---

## 17. Quand un broker ignore ou refuse (escalade RGPD)

C'est le véritable aboutissement de l'article 17.

- **Pas de réponse sous 1 mois.** L'outil l'aura déjà relancé (`reminded`). Le délai
  légal est d'**un mois** (extensible à 3 pour les cas complexes, art. 12.3, avec
  information). Passé ce délai sans réponse satisfaisante, tu peux déposer une
  **plainte auprès de la CNIL** : <https://www.cnil.fr/fr/plaintes>.
- **Refus.** Le broker doit **motiver** son refus (art. 12.4). Certains motifs sont
  légitimes (obligation légale de conservation, etc.). Si le refus te paraît infondé →
  plainte CNIL également.
- **Hors France / UE.** Saisis l'autorité de protection des données de ton pays
  (liste des autorités via l'EDPB : <https://edpb.europa.eu/about-edpb/about-edpb/members_fr>).

**Ce qui t'aide pour une plainte :** l'**export** (`cli export`) contient l'historique
horodaté — date d'envoi, échéance, relances, réponses classées — c'est exactement la
trace que la CNIL demande. Garde aussi les emails dans ta boîte.

> Ce guide n'est pas un conseil juridique. Il t'oriente vers les démarches officielles.

---

## 18. Sécurité & bonnes pratiques

- **`.env` jamais committé** (il est git-ignoré). Ne colle jamais de secret dans un
  commit, une issue ou un message.
- **Secrets jamais loggés** : l'outil masque automatiquement les valeurs sensibles
  (passphrase, mots de passe, `LIVE_CONFIRM`) dans toutes les sorties.
- **Base entièrement chiffrée** (SQLCipher) : `data/deletedata.db` est illisible sans
  la passphrase.
- **Sauvegarde** : si tu sauvegardes `data/`, le fichier reste chiffré — mais
  **sauvegarde aussi ta passphrase séparément** (sinon la sauvegarde est inutile).
- **Clé Vertex JSON** : range-la hors du dépôt, restreins ses permissions
  (`chmod 600`), révoque-la si compromise.
- **App password Gmail** : révocable à tout moment depuis ton compte Google.

---

## 19. Dépannage (FAQ)

### Installation

**`npm install` échoue sur `better-sqlite3` / erreur de compilation.**
Il manque les outils de build natifs. Installe-les (section 3) puis relance
`npm install`. Sur Windows, préfère WSL2.

**`npx playwright install chromium` échoue.**
Réseau/proxy d'entreprise possible. Réessaie ; sinon les commandes hors formulaires
(email, IMAP, status) fonctionnent sans Playwright — il n'est requis que pour
`forms` et `rescan`.

### Base de données

**« cannot open database » / « file is not a database » au `db:migrate` ou au lancement.**
La `DB_PASSPHRASE` ne correspond pas à celle qui a créé la base (ou elle est vide).
Une base chiffrée ne s'ouvre qu'avec **sa** passphrase. Si tu l'as changée par erreur
et que la base ne contient rien d'important : supprime `data/deletedata.db*` et refais
`db:migrate`. **Si tu as perdu la passphrase d'une base remplie : irrécupérable.**

### Envoi (SMTP)

**« Invalid login » / « Username and Password not accepted ».**
Tu utilises ton vrai mot de passe Gmail au lieu de l'**app password** (section 5.1),
ou la 2FA n'est pas activée. Recrée un app password et colle les 16 caractères dans
`SMTP_PASS`.

**Rien ne part alors que je veux envoyer pour de vrai.**
Tu es en dry-run. Il faut **les deux** : `DRY_RUN=false` **ET**
`LIVE_CONFIRM=I_UNDERSTAND` dans `.env`. `cli status` te confirme le mode courant.

**« Envoi réel bloqué par les garde-fous ».**
Message volontaire : l'un des deux verrous manque. C'est la sécurité anti-envoi
accidentel.

### Réception / vérification (IMAP)

**`verify` ne trouve aucune réponse alors que j'ai reçu des emails.**
Vérifie `IMAP_MAILBOX` (par défaut `INBOX`). Si les réponses arrivent dans un libellé
Gmail, indique-le. Vérifie aussi que l'app password IMAP est bon (`test-connections`).

**Une réponse va « à revoir » au lieu d'être rattachée.**
Le broker a répondu depuis une adresse inattendue, sans citer l'alias. Normal et
voulu (pas de classement au hasard). Tu peux gérer ces mails depuis la file.

### Classification (Vertex)

**Erreur d'authentification Vertex.**
`GOOGLE_APPLICATION_CREDENTIALS` doit pointer vers le **chemin absolu** d'une clé JSON
valide, dont le compte de service a le rôle `Utilisateur Vertex AI`. En dev local :
`gcloud auth application-default login`.

**Erreur 429 (quota).**
L'outil réessaie automatiquement avec un délai croissant. Si ça persiste, espace les
`verify` ou demande une hausse de quota côté GCP.

**Je n'ai pas (encore) Vertex.**
Utilise `npm run cli -- verify --no-classify` : rattachement sans LLM, tu lis le
verdict toi-même.

### Formulaires (Playwright)

**`forms rehearse` remplit 0 champ.**
Tes sélecteurs ne matchent pas (la page a changé, ou ils sont dans une iframe).
Ré-inspecte la page (section 13) et regarde le screenshot dans `./screenshots`.

---

## 20. Référence rapide des commandes

> Toutes via `npm run cli -- <commande>`. Aide intégrée : ajoute `--help`.

| Commande                              | Rôle                                                        |
| ------------------------------------- | ----------------------------------------------------------- |
| `doctor`                              | Diagnostic : config, base, état, prochaine action (rien envoyé) |
| `db migrate`                          | Crée/met à jour la base chiffrée                            |
| `identity add … / identity list`      | Déclare/voir tes identités                                  |
| `brokers seed`                        | Charge le jeu curaté EU/FR (actif)                          |
| `brokers import <source>`             | Importe une source large (`eraser`/`justvanish`/`badbool`)  |
| `brokers list [--active …]`           | Liste/filtre les brokers                                    |
| `brokers activate/deactivate <slug>`  | (Dé)active un broker                                        |
| `brokers override <slug> --set k=v`   | Corrige un broker sans coder                                |
| `draft`                               | Génère un lot de brouillons « à approuver »                 |
| `review [batchId] [--full]`           | Liste les lots / détaille un lot                            |
| `approve <batchId>` / `reject <id>`   | Approuve / rejette un lot                                   |
| `send [--batch --request --max]`      | Envoie les demandes approuvées (dry-run par défaut)         |
| `verify [--no-classify]`              | Vérifie les réponses par IMAP (+ classification)            |
| `forms set-config <slug> --file`      | Attache une config de formulaire                            |
| `forms rehearse <slug>`               | Remplit le formulaire sans soumettre (test)                 |
| `rescan set-config <slug> --file`     | Attache une config de re-scan                               |
| `rescan run [--broker]`               | Re-scanne les profils publics                               |
| `remind [--max]`                      | Relance les demandes hors délai                             |
| `cycle [--no-…]`                      | Cycle complet (re-scan + verify + remind + draft)           |
| `schedule [--cron --now]`             | Lance le scheduler (processus long)                         |
| `serve [--port]`                      | API + dashboard sur `127.0.0.1`                             |
| `status`                              | Vue d'ensemble + % confirmé honnête                         |
| `requests [--status …]`               | Liste filtrée des demandes                                  |
| `export [--format --out]`             | Exporte l'historique (preuve RGPD)                          |

---

## 21. Glossaire

- **Data broker** : entreprise qui collecte, agrège et revend des données
  personnelles (annuaires en ligne, marketing, scoring…).
- **RGPD art. 17** : droit à l'effacement (« droit à l'oubli »).
- **Plus-addressing** : alias `email+étiquette@domaine` routé vers ta boîte ; sert ici
  à identifier de façon fiable quel broker répond.
- **Dry-run** : mode simulation, aucun envoi réel.
- **Lot (batch)** : ensemble de demandes générées ensemble, approuvées d'un coup.
- **`acknowledged`** : accusé de réception — **n'est pas** une suppression.
- **`confirmed_email` / `confirmed_rescan`** : suppression prouvée (par email / par
  re-scan public). Seuls ces deux statuts comptent dans le % confirmé.
- **Réacquisition** : un profil supprimé qui réapparaît plus tard.
- **CNIL** : autorité française de protection des données (où déposer plainte).
</content>
</invoke>
