# Seny Mbow – Devis & Factures

Contenu du dossier
- `index.html` : l'application (un seul fichier).
- `manifest.webmanifest`, `sw.js`, `icon-*.png` : installation comme application et ouverture sans internet.
- `netlify.toml` : configuration Netlify.
- `netlify/functions/ctl.mjs` + `package.json` : contrôle des employés (journal d'activité et comptes partagés entre téléphones).
- `netlify/functions/send-whatsapp.js` : envoi automatique WhatsApp (API Meta). Facultatif : l'appli
  n'en a pas besoin pour fonctionner, aucun bouton ne l'appelle pour l'instant.

Mettre en ligne
1. Netlify > « Add new site » > importer ce dossier (GitHub ou Netlify CLI : `netlify deploy --prod`).
2. L'appli s'ouvre sur l'adresse fournie par Netlify. Elle s'installe comme application (PWA) et s'ouvre aussi sans internet une fois visitée une première fois. Après chaque mise à jour des fichiers, augmenter `VERSION` dans `sw.js`.

Envoi WhatsApp depuis l'appli
- Bouton « Envoyer » : 1) « Ouvrir la conversation » ouvre WhatsApp directement sur le numéro saisi (sans l'enregistrer)
  avec le message ; 2) après l'envoi du message, « Partager le PDF » > WhatsApp > la conversation en haut des
  discussions récentes. « Choisir un fichier » permet de partager à la place une photo ou un PDF (document signé).

Importer / scanner (menu « Importer »)
- Choisir un fichier (PDF ou photo) ou scanner : lecture automatique (connexion internet nécessaire), correction des lignes,
  puis création d'un devis ou d'une facture au format habituel.

Envoi automatique par l'API (facultatif, plus tard)
Variables Netlify : WA_TOKEN, WA_PHONE_ID, WA_TEMPLATE, WA_LANG (fr), APP_KEY.


Connexion par clé d'accès uniquement
- Chaque personne se connecte avec une seule chose : sa clé d'accès (8 caractères minimum, sans espace), définie par l'administrateur dans Réglages > Utilisateurs (bouton « Générer » possible). Chaque clé est unique : c'est elle qui identifie la personne.
- Première installation (administrateur) : sur l'écran de connexion, « Première installation », créer sa clé ; puis Réglages > Contrôle des employés > « Définir la clé » et saisir la clé de l'entreprise (variable `APP_KEY` créée dans Netlify > Site configuration > Environment variables, puis redéployer). À faire une seule fois.
- Nouvel appareil (téléphone ou ordinateur) : l'employé tape seulement sa clé d'accès ; l'appareil se relie tout seul au serveur (internet requis pour la première connexion). Ensuite la connexion fonctionne aussi hors ligne.
- Protection : 5 erreurs => attente de 30 s sur l'appareil ; 10 erreurs en 10 minutes => le serveur bloque les nouvelles connexions pendant 10 minutes. Chaque essai raté est inscrit au journal d'activité.
- Retirer l'accès / changer la clé d'un employé : l'ancienne clé ne marche plus sur ses appareils dès qu'ils retrouvent internet.
- Un employé ne reçoit jamais les clés des autres.

Journal d'activité et rapports (administrateur)
- Menu « Activité », actualisé automatiquement toutes les 30 secondes : journal des actions, connexions, clés erronées, annulations, paiements encaissés par employé.
- « Rapport mensuel » : tableau par employé et encaissements par jour, téléchargement Excel (CSV).
- Réglages > Contrôle des employés : droits par employé (créer, modifier, facturer, encaisser, envoyer, annuler, importer) et ajout d'employés.

Un seul logiciel : même compte sur téléphone et ordinateur
- Chaque employé retrouve ses devis, factures et clients sur tous ses appareils en se connectant avec sa clé. L'administrateur voit les données de tous les employés ; un employé ne voit que les siennes.
- Numérotation : chaque devis/facture reçoit un numéro unique réservé sur le serveur (internet requis pour CRÉER un devis ou une facture). Consulter, modifier et encaisser fonctionnent hors ligne et se synchronisent ensuite.
- Au premier lancement, l'administrateur doit se connecter une fois avec la clé de l'entreprise définie : ses données existantes sont envoyées au serveur.
- « Restaurer une sauvegarde » et « Réinitialiser » sont désactivés en mode partagé.


Dépannage (v21)
- Ouvrir `https://TON-SITE.netlify.app/api/ctl?a=ping` dans le navigateur : doit afficher `"fn":true`, `"appKey":true` et `"store":"strong"`. Sinon : fonction non déployée (déployer par GitHub ou `netlify deploy --prod`, pas par simple glisser-déposer, car `npm install` doit s'exécuter), ou APP_KEY manquante (puis redéployer).
- Dans l'appli, administrateur : Réglages > Contrôle des employés > « Diagnostic » liste ce qui fonctionne et ce qui bloque.
- v21 : lecture « forte » de Netlify Blobs (sinon retards jusqu'à 60 s qui bloquaient numérotation et synchro), @netlify/blobs 10 (protection réelle contre les écritures simultanées, donc plus de numéros en double), la réservation de numéro ne dépend plus de la synchro des documents, et les messages d'erreur indiquent la vraie cause.
