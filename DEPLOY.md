# DEPLOY.md — Héberger `deletedata` en ligne, **gratuitement** et **en privé**

Objectif : accéder à ton dashboard **depuis ton téléphone ou ton PC, de partout**,
mais que **toi** y aies accès — gratuitement, et sans exposer tes données sur
l'Internet public.

```
[ton téléphone / PC]  ──(Tailscale, chiffré, privé)──▶  [petite VM Linux gratuite]
                                                              │
                                                     deletedata (dashboard + base
                                                     chiffrée + scheduler)
                                                              │
                                                     ──▶ Gmail (SMTP/IMAP), Vertex AI
```

> ❌ **Pourquoi pas Vercel / Netlify / Render (gratuits) ?** Ils sont faits pour des
> sites statiques et des fonctions « serverless » très courtes. Or l'outil a besoin
> de l'inverse : une **base SQLite chiffrée qui persiste**, un **scheduler qui tourne
> en continu**, et un **navigateur (Playwright)** pour les formulaires/re-scan. Ces
> plateformes ne peuvent rien stocker durablement ni faire tourner un process long →
> **ça ne marche pas** pour ce projet. Il faut une vraie (petite) machine.

La voie gratuite + privée tient en 8 étapes : une **VM gratuite à vie** (Oracle
Cloud) rendue accessible **uniquement à tes appareils** via **Tailscale**.

---

## Étape 1 — Créer une VM gratuite à vie (Oracle Cloud « Always Free »)

Oracle Cloud offre une VM **gratuite à vie** (« Always Free ») — assez puissante pour
tout faire tourner.

1. Crée un compte sur <https://cloud.oracle.com>. Une **carte bancaire est demandée
   pour la vérification d'identité**, mais les ressources « Always Free » ne sont
   **jamais débitées**.
2. Choisis une **région de l'UE** (Paris, Frankfurt, Amsterdam…) → tes données
   restent en Europe (RGPD).
3. **Menu → Compute → Instances → Create Instance** :
   - **Image** : Ubuntu 22.04 (ou 24.04).
   - **Shape** : clique « Change shape » → onglet **Ampere (ARM)** →
     `VM.Standard.A1.Flex`, mets **1 ou 2 OCPU** et **6–12 GB** de RAM (tout est
     dans l'enveloppe Always Free). *(Si « out of capacity », prends l'AMD
     `VM.Standard.E2.1.Micro` — 1 Go, suffisant si tu n'utilises que l'email.)*
   - **Clés SSH** : laisse Oracle générer une paire et **télécharge la clé privée**
     (ou colle ta clé publique).
   - **Réseau** : garde les réglages par défaut. **N'ouvre aucun port** à part SSH
     (22) — Tailscale s'occupera de l'accès au dashboard.
4. Crée, puis note l'**adresse IP publique** de l'instance.

> 💡 **Pas envie de cloud ?** Si tu as un vieux PC ou un Raspberry Pi qui peut rester
> allumé, **saute les étapes 1–2** et fais les étapes 3–8 directement dessus. C'est
> encore plus simple, 100 % gratuit, et tes données restent physiquement chez toi.

## Étape 2 — Se connecter en SSH

```bash
chmod 600 ma-cle-privee.key
ssh -i ma-cle-privee.key ubuntu@<IP_PUBLIQUE>
```

(Utilisateur : `ubuntu` pour une image Ubuntu.)

## Étape 3 — Installer les prérequis

```bash
sudo apt-get update
sudo apt-get install -y git build-essential python3
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
node --version        # doit afficher v22.x
```

## Étape 4 — Installer deletedata

```bash
git clone https://github.com/Mailpro31/deletedata.git
cd deletedata
npm install
# Optionnel : navigateur pour formulaires + re-scan (inutile si tu n'utilises que
# l'email). Installe aussi les dépendances système nécessaires :
npx playwright install --with-deps chromium
```

## Étape 5 — Configurer et initialiser

```bash
cp .env.example .env
nano .env             # remplir DB_PASSPHRASE, SMTP/IMAP (app password Gmail), Vertex
                      # LAISSER DRY_RUN=true pour l'instant
npm run db:migrate    # crée la base chiffrée
npm run doctor        # vérifie ce qui manque
npm run test-connections
```

*(Astuce : pour éditer `.env` confortablement, tu peux le préparer sur ton PC et le
copier avec `scp -i ma-cle.key .env ubuntu@<IP>:~/deletedata/.env`.)*

## Étape 6 — Tailscale (l'accès privé, de partout)

Tailscale crée un réseau privé chiffré entre **tes** appareils. Gratuit pour un
usage perso.

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up     # ouvre un lien → connecte-toi (Google / email)
```

Installe aussi l'app **Tailscale sur ton téléphone et ton PC**, connectée au **même
compte**. (Dans la console Tailscale, active **HTTPS Certificates** sous *DNS* — pour
l'URL `https://…ts.net` de l'étape 7.)

## Étape 7 — Construire le dashboard et l'exposer (en privé, HTTPS)

```bash
npm run build --prefix web        # construit l'interface une fois
sudo tailscale serve --bg 4317    # proxy HTTPS privé -> 127.0.0.1:4317
tailscale serve status            # affiche l'URL https://<machine>.<tailnet>.ts.net
```

Cette URL `…ts.net` n'est **joignable que depuis tes appareils Tailscale**. Rien
n'est public.

> Si ta version de Tailscale utilise une autre syntaxe : `tailscale serve --help`
> (ancienne forme : `tailscale serve https / http://localhost:4317`).

## Étape 8 — Faire tourner 24/7 (redémarrage automatique)

Crée le service systemd du dashboard :

```bash
sudo tee /etc/systemd/system/deletedata.service > /dev/null <<'UNIT'
[Unit]
Description=deletedata — dashboard RGPD
After=network-online.target tailscaled.service
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/deletedata
Environment=HOME=/home/ubuntu
ExecStart=/usr/bin/npm run cli -- serve --port 4317
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now deletedata
sudo systemctl status deletedata        # doit être "active (running)"
```

**(Optionnel) Cycles automatiques** tous les 2-3 mois (re-scan + vérif + relances +
brouillons) sans rien cliquer — un 2ᵉ service :

```bash
sudo tee /etc/systemd/system/deletedata-scheduler.service > /dev/null <<'UNIT'
[Unit]
Description=deletedata — scheduler
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/deletedata
Environment=HOME=/home/ubuntu
ExecStart=/usr/bin/npm run cli -- schedule
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now deletedata-scheduler
```

*(Sinon, plus simple : clique « Cycle complet » dans le dashboard quand tu veux.)*

## C'est prêt 🎉

Depuis ton téléphone ou ton PC (connectés à Tailscale), ouvre l'URL `…ts.net` :
ton dashboard `deletedata`, en ligne, privé, gratuit.

---

## Sécurité — à respecter

- **N'ouvre jamais le port 4317 sur l'Internet public.** Aucune règle entrante pour
  4317 côté Oracle ; seul Tailscale y accède. (Le dashboard n'a **pas** de mot de
  passe : sans Tailscale, n'importe qui pourrait piloter tes données.)
- **`.env` jamais committé** (déjà git-ignoré). **Sauvegarde `DB_PASSPHRASE`** dans
  ton gestionnaire de mots de passe — sans elle, la base est irrécupérable.
- Garde **`DRY_RUN=true`** tant que tu n'as pas relu les emails ; passage en réel =
  double verrou (`DRY_RUN=false` + `LIVE_CONFIRM=I_UNDERSTAND`).

## Maintenance

```bash
# Mettre à jour
cd ~/deletedata && git pull && npm install && sudo systemctl restart deletedata

# Voir les logs en direct
journalctl -u deletedata -f
journalctl -u deletedata-scheduler -f

# Arrêter / démarrer
sudo systemctl stop deletedata
sudo systemctl start deletedata
```

## Si Oracle ne te convient pas

- **Google Cloud** : VM `e2-micro` **Always Free** (régions US uniquement, 1 Go RAM —
  ajoute un fichier d'échange pour Chromium). Pratique si tu as déjà un projet GCP
  pour Vertex.
- **Chez toi** : Raspberry Pi 4/5 ou vieux PC sous Linux. Mêmes étapes 3–8. Le plus
  privé (tout reste chez toi), mais laisse la machine allumée pour le scheduler.
</content>
