# Veille emploi professeur de lettres

Le workflow ouvre la page dynamique de recrutement de l'Éducation nationale, recherche les offres liées à `lettres` ou `français` en Île-de-France, et envoie un message **Telegram** pour chaque nouvelle offre.

## Mise en place

1. Créez un bot Telegram avec [@BotFather](https://t.me/BotFather) pour obtenir un `TELEGRAM_BOT_TOKEN`.
2. Récupérez votre `TELEGRAM_CHAT_ID` (par exemple en envoyant un message à votre bot puis en interrogeant `https://api.telegram.org/bot<TOKEN>/getUpdates`).
3. Dans le dépôt GitHub : **Settings → Secrets and variables → Actions**, créez :
   - `TELEGRAM_BOT_TOKEN` : le jeton fourni par BotFather ;
   - `TELEGRAM_CHAT_ID` : votre identifiant de conversation.
4. Ne mettez jamais ces valeurs dans le code ni dans les fichiers du dépôt.

## Test

Dans l'onglet **Actions**, ouvrez *Veille offres professeur de lettres* → **Run workflow**, puis cochez **Envoyer un message Telegram de test**. Vous devez recevoir immédiatement un message de confirmation.

## Fonctionnement

- Exécution automatique toutes les **2 heures** (à la 17e minute, heure UTC).
- Déduplication par **titre + date de publication** : vous n'êtes alerté que pour les offres réellement nouvelles.
- Les offres déjà vues sont conservées dans `data/seen.json`.
