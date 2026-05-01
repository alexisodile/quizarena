# 🎮 QUIZ ARENA — Guide d'installation

## Ce qu'il te faut

- Un compte **Render.com** (gratuit) → render.com
- Une clé **API Anthropic** → console.anthropic.com
- Un compte **GitHub** → github.com

---

## ⚡ Installation en 5 étapes

---

### ÉTAPE 1 — Prépare les fichiers

Télécharge le dossier `quizarena/` (joint dans le zip).

Il contient :
```
quizarena/
├── package.json
├── server/
│   └── index.js        ← le serveur
└── public/
    └── index.html      ← le jeu
```

---

### ÉTAPE 2 — Mets les fichiers sur GitHub

1. Va sur **github.com** → clique "New repository"
2. Nomme-le `quizarena` → clique "Create repository"
3. Clique "uploading an existing file"
4. Glisse tous les fichiers du dossier `quizarena/` dedans
5. Clique "Commit changes"

---

### ÉTAPE 3 — Déploie sur Render (gratuit)

1. Va sur **render.com** → crée un compte gratuit
2. Clique **"New +"** → **"Web Service"**
3. Connecte ton compte GitHub → sélectionne le repo `quizarena`
4. Configure comme ça :

| Champ | Valeur |
|-------|--------|
| **Name** | quizarena |
| **Runtime** | Node |
| **Build Command** | `npm install` |
| **Start Command** | `npm start` |
| **Instance Type** | Free |

5. Clique **"Create Web Service"**

---

### ÉTAPE 4 — Ajoute ta clé API Anthropic

Toujours sur Render, dans ton service :

1. Clique sur **"Environment"** dans le menu de gauche
2. Clique **"Add Environment Variable"**
3. Remplis :
   - **Key** : `ANTHROPIC_API_KEY`
   - **Value** : ta clé qui commence par `sk-ant-...`
4. Clique **"Save Changes"**

> 🔑 Ta clé API est sur **console.anthropic.com** → "API Keys"
> Si tu n'en as pas, crée un compte Anthropic et ajoute quelques crédits (5€ suffisent largement pour des centaines de parties).

---

### ÉTAPE 5 — C'est prêt ! 🎉

Render va build et déployer (ça prend ~2 minutes).

Ton URL sera quelque chose comme :
```
https://quizarena.onrender.com
```

**Donne cette URL à ton chat** — les viewers cliquent dessus, entrent un pseudo, et rejoignent ta partie !

---

## 🎮 Comment jouer en stream

1. **Tu** ouvres l'URL et cliques **"Créer une partie"**
2. Un **lien unique** s'affiche → tu le mets dans ta description/chat
3. Les viewers cliquent le lien → ils arrivent directement dans ta partie
4. Tu cliques **"Lancer la partie"** quand tout le monde est là
5. L'IA génère 10 questions fraîches → la partie commence !
6. Chaque bonne réponse rapide = plus de points
7. Classement final avec podium 🥇🥈🥉

---

## ⚠️ Notes importantes

**Plan gratuit Render** : le serveur "s'endort" après 15 min d'inactivité. La première connexion peut prendre 30-60 secondes pour se réveiller. Pour éviter ça, upgrade à 7$/mois ou utilise un service "uptime" gratuit comme uptimerobot.com.

**Coût API** : chaque partie génère ~10 questions = environ **0,01€** par partie. Avec 5€ de crédits tu as ~500 parties.

**Nombre de joueurs** : testé jusqu'à ~50 joueurs simultanés sur le plan gratuit.

---

## 🔧 Problèmes fréquents

**"Partie introuvable"** → Le serveur s'est peut-être endormi. Attends 30s et réessaie.

**Questions en fallback (pas générées par l'IA)** → Vérifie que `ANTHROPIC_API_KEY` est bien configurée dans Render > Environment.

**WebSocket déconnecté** → Rafraîchis la page. Les WebSockets se reconnectent automatiquement.

---

## 📞 Support

Des questions ? Ouvre une issue sur ton repo GitHub.
