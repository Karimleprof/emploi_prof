# Veille emploi professeur de lettres

Le workflow ouvre la page dynamique de recrutement, recherche les offres liées à `lettres` ou `français`, puis envoie uniquement les nouvelles offres par Gmail.

## Installation GitHub

1. Copiez ces fichiers dans le dépôt `Karimleprof/emploi_prof`.
2. Lancez `npm install` puis commitez aussi `package-lock.json`.
3. Dans **Settings → Secrets and variables → Actions**, créez :
   - `GMAIL_USER` : votre adresse Gmail ;
   - `GMAIL_APP_PASSWORD` : un mot de passe d’application Google à 16 caractères ;
   - `ALERT_TO` : l’adresse recevant les alertes.
4. Dans **Actions**, lancez une fois le workflow manuellement pour vérifier la configuration.

Le mot de passe d’application nécessite la validation en deux étapes sur le compte Google. Ne mettez jamais le mot de passe Gmail principal dans le dépôt.

Le workflow est ensuite planifié toutes les deux heures, à la 17e minute, en UTC. Les offres déjà envoyées sont conservées dans `data/seen.json`.
